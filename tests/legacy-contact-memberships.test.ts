import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/contacts';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const contacts = await Promise.all(
    [1, 2].map(() =>
      db.contacts.create({
        data: {
          vendorId: f.vendorId,
          assignedUserId: f.userId,
          status: 1,
          wabPhoneNumberId: '123456789',
        },
      }),
    ),
  );
  const groups = await Promise.all(
    [1, 2].map((i) =>
      db.contactGroups.create({
        data: {
          vendorId: f.vendorId,
          title: `Group ${i}`,
          status: 1,
          wabPhoneNumberId: '123456789',
        },
      }),
    ),
  );
  const call = (path: string, body: Record<string, unknown> = {}) =>
    request(app).post(`${base}${path}`).set('Authorization', `Bearer ${f.token}`).send(body);
  const assign = (
    body: Record<string, unknown> = {
      selected_contacts: contacts.map((c) => c.uid),
      selected_groups: groups.map((g) => g.id),
    },
  ) => call('/assign-groups-selected-process', body);
  return { ...f, contacts, groups, call, assign };
}
describe('original contact group membership adapters', () => {
  it('adds a Cartesian selection without replacing existing memberships, then repeats with no changes', async () => {
    const f = await fixture();
    await db.groupContacts.create({
      data: { contactId: f.contacts[0].id, groupId: f.groups[0].id },
    });
    const result = await f.assign();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      affectedMemberships: 3,
      reloadDatatableId: '#lwContactList',
      modalId: '#lwAssignGroups',
    });
    expect((await f.assign()).body).toMatchObject({
      affectedMemberships: 0,
      message: 'No changes',
    });
    expect(
      await db.groupContacts.count({ where: { groupId: { in: f.groups.map((g) => g.id) } } }),
    ).toBe(4);
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'assign-groups' } }),
    ).toBe(1);
  });
  it('removes only the chosen membership by numeric or UUID contact, retaining contacts and other groups', async () => {
    const f = await fixture();
    await f.assign();
    for (const identifier of [f.contacts[0].id, f.contacts[1].uid]) {
      const result = await f.call(`/${identifier}/${f.groups[0].uid}/remove-process`);
      expect(result.status).toBe(200);
      expect(result.body.affectedMemberships).toBe(1);
      expect(
        (await f.call(`/${identifier}/${f.groups[0].uid}/remove-process`)).body.affectedMemberships,
      ).toBe(0);
    }
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(2);
    expect(await db.groupContacts.count({ where: { groupId: f.groups[1].id } })).toBe(2);
  });
  it('rejects a mixed foreign or missing selection before writing', async () => {
    const f = await fixture(),
      foreign = await fixture();
    for (const selected of [foreign.contacts[0].uid, randomUUID()])
      expect(
        (
          await f.assign({
            selected_contacts: [f.contacts[0].uid, selected],
            selected_groups: [f.groups[0].id],
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await f.assign({
          selected_contacts: [f.contacts[0].uid],
          selected_groups: [f.groups[0].id, foreign.groups[0].id],
        })
      ).status,
    ).toBe(404);
    expect(
      (await f.call(`/${f.contacts[0].uid}/${foreign.groups[0].uid}/remove-process`)).status,
    ).toBe(404);
    expect(
      await db.groupContacts.count({ where: { groupId: { in: f.groups.map((g) => g.id) } } }),
    ).toBe(0);
  });
  it('requires full visibility for bulk assignment but scopes single removal to assigned contacts', async () => {
    const f = await fixture([
      'vendor.contacts.edit',
      'vendor.groups.manage',
      'vendor.chats.view_assigned',
    ]);
    expect((await f.assign()).status).toBe(403);
    await db.groupContacts.create({
      data: { contactId: f.contacts[0].id, groupId: f.groups[0].id },
    });
    expect((await f.call(`/${f.contacts[0].uid}/${f.groups[0].uid}/remove-process`)).status).toBe(
      200,
    );
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { assignedUserId: null } });
    expect((await f.call(`/${f.contacts[1].uid}/${f.groups[0].uid}/remove-process`)).status).toBe(
      404,
    );
    expect(
      (await request(app).post(`${base}/assign-groups-selected-process`).send({})).status,
    ).toBe(401);
  });
  it('blocks inactive and incompatible phone selections atomically while allowing archived membership removal', async () => {
    const f = await fixture();
    await db.contactGroups.update({
      where: { id: f.groups[1].id },
      data: { wabPhoneNumberId: '987654321' },
    });
    expect((await f.assign()).body.error.code).toBe('PHONE_SCOPE_MISMATCH');
    await db.contactGroups.update({
      where: { id: f.groups[1].id },
      data: { wabPhoneNumberId: '123456789', status: 5 },
    });
    expect((await f.assign()).body.error.code).toBe('INACTIVE_SELECTION');
    await db.groupContacts.create({
      data: { contactId: f.contacts[0].id, groupId: f.groups[1].id },
    });
    expect(
      (await f.call(`/${f.contacts[0].uid}/${f.groups[1].uid}/remove-process`)).body
        .affectedMemberships,
    ).toBe(1);
    expect(await db.groupContacts.count({ where: { groupId: f.groups[0].id } })).toBe(0);
  });
  it('blocks imported cross-business group links', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await db.groupContacts.create({
      data: { contactId: foreign.contacts[0].id, groupId: f.groups[0].id },
    });
    expect((await f.assign()).body.error.code).toBe('GROUP_SCOPE_PENDING');
    expect(
      (await f.call(`/${f.contacts[0].uid}/${f.groups[0].uid}/remove-process`)).body.error.code,
    ).toBe('GROUP_SCOPE_PENDING');
    expect(await db.groupContacts.count({ where: { groupId: f.groups[1].id } })).toBe(0);
  });
  it('rolls back additions and removals when auditing fails', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    function failAudit() {
      vi.spyOn(db, '$transaction').mockImplementationOnce(((callback: any) =>
        transaction(async (tx) =>
          callback(
            new Proxy(tx, {
              get(target, key, receiver) {
                return key === 'auditEvents'
                  ? {
                      ...tx.auditEvents,
                      create: async () => {
                        throw new Error('audit unavailable');
                      },
                    }
                  : Reflect.get(target, key, receiver);
              },
            }),
          ),
        )) as any);
    }
    failAudit();
    expect((await f.assign()).status).toBe(500);
    expect(await db.groupContacts.count({ where: { groupId: f.groups[0].id } })).toBe(0);
    await f.assign();
    failAudit();
    expect((await f.call(`/${f.contacts[0].uid}/${f.groups[0].uid}/remove-process`)).status).toBe(
      500,
    );
    expect(
      await db.groupContacts.count({ where: { groupId: { in: f.groups.map((g) => g.id) } } }),
    ).toBe(4);
  });
  it('uses the same guards for native add/remove and serializes concurrent original/native additions', async () => {
    const f = await fixture();
    const native = () =>
      request(app)
        .post(`/api/v1/vendors/${f.vendorId}/contacts/${f.contacts[0].id}/groups`)
        .set('Authorization', `Bearer ${f.token}`)
        .send({ groupId: f.groups[0].id });
    const results = await Promise.all([
      f.assign({ selected_contacts: [f.contacts[0].uid], selected_groups: [f.groups[0].id] }),
      native(),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 204]);
    expect(
      await db.groupContacts.count({
        where: { contactId: f.contacts[0].id, groupId: f.groups[0].id },
      }),
    ).toBe(1);
    expect(
      (
        await request(app)
          .delete(
            `/api/v1/vendors/${f.vendorId}/contacts/${f.contacts[0].id}/groups/${f.groups[0].id}`,
          )
          .set('Authorization', `Bearer ${f.token}`)
      ).status,
    ).toBe(204);
    await db.contactGroups.update({ where: { id: f.groups[0].id }, data: { status: 5 } });
    expect((await native()).body.error.code).toBe('INACTIVE_SELECTION');
  });
  it('rejects empty, duplicate, oversized, malformed and server-owned selections', async () => {
    const f = await fixture();
    for (const selected_contacts of [
      [],
      [f.contacts[0].uid, f.contacts[0].uid],
      Array.from({ length: 101 }, () => randomUUID()),
      [f.contacts[0].id],
    ])
      expect(
        (await f.assign({ selected_contacts, selected_groups: [f.groups[0].id] })).status,
      ).toBe(400);
    for (const selected_groups of [
      [],
      [f.groups[0].id, f.groups[0].id],
      [f.groups[0].uid],
      Array.from({ length: 51 }, (_, i) => i + 1),
    ])
      expect(
        (await f.assign({ selected_contacts: [f.contacts[0].uid], selected_groups })).status,
      ).toBe(400);
    expect(
      (
        await f.assign({
          selected_contacts: [f.contacts[0].uid],
          selected_groups: [f.groups[0].id],
          vendorId: f.vendorId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call(`/${f.contacts[0].uid}/${f.groups[0].uid}/remove-process`, {
          vendorId: f.vendorId,
        })
      ).status,
    ).toBe(400);
  });
});
