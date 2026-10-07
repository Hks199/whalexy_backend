import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/contacts/groups';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const call = (method: 'get' | 'post', path: string, body?: Record<string, unknown>) => {
    const req = request(app)[method](`${base}${path}`).set('Authorization', `Bearer ${f.token}`);
    return body === undefined ? req : req.send(body);
  };
  return {
    ...f,
    call,
    create: (title = 'Sales') =>
      call('post', '/add-process', { title, description: 'Customer group' }),
    native: (id?: number, body: Record<string, unknown> = { title: 'Native group' }) =>
      request(app)
        [id ? 'patch' : 'post'](
          `/api/v1/vendors/${f.vendorId}/resources/groups${id ? `/${id}` : ''}`,
        )
        .set('Authorization', `Bearer ${f.token}`)
        .send(body),
  };
}
describe('original contact-group lifecycle API adapters', () => {
  it('creates, reads by numeric ID/UUID, edits and deletes memberships without deleting contacts', async () => {
    const f = await fixture(),
      result = await f.create();
    expect(result.status).toBe(201);
    const group = result.body.group;
    expect(group).toMatchObject({
      title: 'Sales',
      description: 'Customer group',
      status: 1,
      wab_phone_number_id: null,
    });
    expect(group.vendorId).toBeUndefined();
    for (const id of [group._id, group._uid])
      expect((await f.call('get', `/${id}/get-update-data`)).body).toEqual(group);
    const updated = await f.call('post', '/update-process', {
      contactGroupIdOrUid: group._uid,
      title: 'Support',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.group.description).toBeNull();
    const contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    await db.groupContacts.create({ data: { contactId: contact.id, groupId: group._id } });
    const deleted = await f.call('post', `/${group._id}/delete-process`, {});
    expect(deleted.status).toBe(200);
    expect(deleted.body.removedMemberships).toBe(1);
    expect(await db.groupContacts.count({ where: { groupId: group._id } })).toBe(0);
    expect(await db.contacts.count({ where: { id: contact.id } })).toBe(1);
    expect((await f.call('get', `/${group._uid}/get-update-data`)).status).toBe(404);
    const audit = await db.auditEvents.findMany({
      where: { vendorId: f.vendorId, resource: 'ContactGroups' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((e) => e.action)).toEqual(['create', 'update', 'delete']);
  });
  it('uses source archive status 5 for both original and native endpoints', async () => {
    const f = await fixture(),
      g = (await f.create()).body.group;
    expect((await f.call('post', `/${g._uid}/archive-process`, {})).status).toBe(200);
    expect((await db.contactGroups.findUniqueOrThrow({ where: { id: g._id } })).status).toBe(5);
    expect((await f.call('post', `/${g._id}/unarchive-process`, {})).status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${f.vendorId}/groups/${g._id}/archive`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ archived: true })
      ).status,
    ).toBe(204);
    expect((await db.contactGroups.findUniqueOrThrow({ where: { id: g._id } })).status).toBe(5);
  });
  it('archives, unarchives and deletes a validated bulk selection atomically', async () => {
    const f = await fixture(),
      groups = [(await f.create('First')).body.group, (await f.create('Second')).body.group];
    const selected_groups = groups.map((g) => g._uid);
    for (const [op, status] of [
      ['archive', 5],
      ['unarchive', 1],
    ] as const) {
      const r = await f.call('post', `/${op}-selected-process`, { selected_groups });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ affectedGroups: 2, reloadDatatableId: '#lwGroupList' });
      expect(await db.contactGroups.count({ where: { vendorId: f.vendorId, status } })).toBe(2);
    }
    expect((await f.call('post', '/delete-selected-process', { selected_groups })).status).toBe(
      200,
    );
    expect(await db.contactGroups.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rejects mixed foreign/missing, duplicate or empty selections without partial writes', async () => {
    const f = await fixture(),
      other = await fixture(),
      own = (await f.create()).body.group,
      foreign = (await other.create()).body.group;
    for (const op of ['archive', 'unarchive', 'delete']) {
      expect(
        (
          await f.call('post', `/${op}-selected-process`, {
            selected_groups: [own._uid, foreign._uid],
          })
        ).status,
      ).toBe(404);
      expect(
        (await f.call('post', `/${op}-selected-process`, { selected_groups: [own._uid, own._uid] }))
          .status,
      ).toBe(400);
      expect(
        (await f.call('post', `/${op}-selected-process`, { selected_groups: [] })).status,
      ).toBe(400);
    }
    expect((await db.contactGroups.findUniqueOrThrow({ where: { id: own._id } })).status).toBe(1);
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, resource: 'ContactGroups' } }),
    ).toBe(1);
  });
  it('lists only owned active/archived groups with bounded source DataTables queries and stable sorting', async () => {
    const f = await fixture(),
      other = await fixture();
    await f.create('Zebra');
    await f.create('Apple');
    const archive = (await f.create('Archived')).body.group;
    await f.call('post', `/${archive._uid}/archive-process`, {});
    await other.create('Secret');
    const r = await f.call('get', '/list-data').query({
      draw: 9,
      start: 1,
      length: 1,
      'order[0][column]': 2,
      'order[0][dir]': 'asc',
      'columns[2][data]': 'title',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ draw: 9, recordsTotal: 2, recordsFiltered: 2 });
    expect(r.body.data[0].title).toBe('Zebra');
    expect((await f.call('get', '/archived/list-data')).body.data.map((g: any) => g._uid)).toEqual([
      archive._uid,
    ]);
    const filtered = await f.call('get', '/active/list-data').query({ 'search[value]': 'APP' });
    expect(filtered.body.recordsFiltered).toBe(1);
    expect(filtered.body.data[0].title).toBe('Apple');
  });
  it('enforces administration/full visibility for source and native mutations', async () => {
    const viewer = await fixture(['vendor.contacts.view']),
      manager = await fixture(['vendor.contacts.view', 'vendor.groups.manage']);
    for (const f of [viewer, manager]) {
      expect((await f.create()).status).toBe(403);
      expect((await f.call('get', '/list-data')).status).toBe(403);
      expect((await f.native()).status).toBe(403);
    }
    expect((await request(app).get(`${base}/list-data`)).status).toBe(401);
    const f = await fixture(),
      other = await fixture(),
      group = (await f.create()).body.group;
    expect((await other.call('get', `/${group._uid}/get-update-data`)).status).toBe(404);
    expect(
      (
        await other.call('post', '/update-process', {
          contactGroupIdOrUid: group._id,
          title: 'Stolen',
        })
      ).status,
    ).toBe(404);
  });
  it('blocks edits, archive and deletion of imported cross-business group links', async () => {
    const f = await fixture(),
      other = await fixture(),
      g = (await f.create()).body.group;
    const contact = await db.contacts.create({ data: { vendorId: other.vendorId } });
    await db.groupContacts.create({ data: { contactId: contact.id, groupId: g._id } });
    for (const op of ['archive', 'delete']) {
      const r = await f.call('post', `/${g._uid}/${op}-process`, {});
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('GROUP_SCOPE_PENDING');
    }
    expect((await f.native(g._id, { title: 'Changed' })).status).toBe(409);
    expect(await db.groupContacts.count({ where: { groupId: g._id } })).toBe(1);
  });
  it('retains groups referenced by campaigns and blocks populated phone-scope changes', async () => {
    const f = await fixture(),
      g = (await f.create()).body.group;
    const template = await db.whatsappTemplates.create({
      data: {
        vendorId: f.vendorId,
        templateName: 'group_guard',
        languageCode: 'en',
        status: 'APPROVED',
      },
    });
    await db.campaigns.create({
      data: {
        vendorId: f.vendorId,
        title: 'Bound campaign',
        templateId: template.id,
        status: 'paused',
        data: { groupIds: [g._id] },
      },
    });
    const rejected = await f.call('post', `/${g._uid}/delete-process`, {});
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('GROUP_IN_USE');
    expect((await f.native(g._id, { wabPhoneNumberId: 'other-phone' })).status).toBe(409);
    const fresh = (await f.create('Populated')).body.group,
      contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    await db.groupContacts.create({ data: { contactId: contact.id, groupId: fresh._id } });
    expect((await f.native(fresh._id, { wabPhoneNumberId: 'other-phone' })).body.error.code).toBe(
      'GROUP_HAS_CONTACTS',
    );
  });
  it('rolls back complete bulk deletion including memberships if audit insertion fails', async () => {
    const f = await fixture(),
      g = (await f.create()).body.group,
      contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    await db.groupContacts.create({ data: { contactId: contact.id, groupId: g._id } });
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((callback: any) =>
      transaction(async (tx) => {
        const audit = {
          ...tx.auditEvents,
          create: async () => {
            throw new Error('audit unavailable');
          },
        };
        return callback(
          new Proxy(tx, {
            get(target, key, receiver) {
              return key === 'auditEvents' ? audit : Reflect.get(target, key, receiver);
            },
          }),
        );
      })) as any);
    expect(
      (await f.call('post', '/delete-selected-process', { selected_groups: [g._uid] })).status,
    ).toBe(500);
    expect(await db.contactGroups.count({ where: { id: g._id } })).toBe(1);
    expect(await db.groupContacts.count({ where: { groupId: g._id } })).toBe(1);
  });
  it('merges unique owned memberships and preserves referenced or malformed sources through both APIs', async () => {
    const f = await fixture(),
      other = await fixture();
    const source = (await f.create('Source')).body.group,
      target = (await f.create('Target')).body.group;
    const contacts = await Promise.all([
      db.contacts.create({ data: { vendorId: f.vendorId } }),
      db.contacts.create({ data: { vendorId: f.vendorId } }),
    ]);
    await db.groupContacts.createMany({
      data: [
        { groupId: source._id, contactId: contacts[0].id },
        { groupId: source._id, contactId: contacts[1].id },
        { groupId: target._id, contactId: contacts[0].id },
      ],
    });
    const merged = await f.call('post', '/merge-process', {
      source_group_uid: source._uid,
      target_group_uid: target._uid,
    });
    expect(merged.status).toBe(200);
    expect(merged.body.movedContactsCount).toBe(1);
    expect(await db.groupContacts.count({ where: { groupId: target._id } })).toBe(2);
    expect(await db.contactGroups.count({ where: { id: source._id } })).toBe(0);
    expect(
      (
        await f.call('post', '/merge-process', {
          source_group_uid: target._uid,
          target_group_uid: target._uid,
        })
      ).status,
    ).toBe(400);
    const guarded = (await f.create('Guarded')).body.group;
    const foreign = await db.contacts.create({ data: { vendorId: other.vendorId } });
    await db.groupContacts.create({ data: { groupId: guarded._id, contactId: foreign.id } });
    expect(
      (
        await f.call('post', '/merge-process', {
          source_group_uid: guarded._uid,
          target_group_uid: target._uid,
        })
      ).body.error.code,
    ).toBe('GROUP_SCOPE_PENDING');
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${f.vendorId}/groups/${guarded._id}/merge`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ targetGroupId: target._id })
      ).status,
    ).toBe(409);
    await db.groupContacts.deleteMany({ where: { groupId: guarded._id } });
    const template = await db.whatsappTemplates.create({
      data: {
        vendorId: f.vendorId,
        templateName: 'merge_guard',
        languageCode: 'en',
        status: 'APPROVED',
      },
    });
    await db.campaigns.create({
      data: {
        vendorId: f.vendorId,
        title: 'Group audience',
        templateId: template.id,
        status: 'paused',
        data: { groupIds: [guarded._id] },
      },
    });
    expect(
      (
        await f.call('post', '/merge-process', {
          source_group_uid: guarded._uid,
          target_group_uid: target._uid,
        })
      ).body.error.code,
    ).toBe('GROUP_IN_USE');
    expect(await db.contactGroups.count({ where: { id: guarded._id } })).toBe(1);
  });
  it('rejects invalid source bodies, unbounded/regex listing and unsafe native status fields', async () => {
    const f = await fixture();
    for (const body of [
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: 'Valid', vendors__id: f.vendorId },
      { title: 'Valid', status: 5 },
      { title: 'Valid', description: 'x'.repeat(4001) },
    ])
      expect((await f.call('post', '/add-process', body)).status).toBe(400);
    expect((await f.native(undefined, { title: 'Valid', status: 0 })).status).toBe(400);
    expect((await f.call('get', '/list-data').query({ length: -1 })).status).toBe(400);
    expect((await f.call('get', '/list-data').query({ 'search[regex]': 'true' })).status).toBe(400);
    expect((await f.call('get', '/invalid/list-data')).status).toBe(400);
    expect(
      (
        await f.call('post', '/delete-selected-process', {
          selected_groups: Array.from({ length: 101 }, () => crypto.randomUUID()),
        })
      ).status,
    ).toBe(400);
  });
});
