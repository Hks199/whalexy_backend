import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/whatsapp/contact';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const call = (path: string, body?: Record<string, unknown>) =>
    request(app)
      .post(`${base}${path}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send(body ?? {});
  const native = (path = '', body: Record<string, unknown> = { title: 'Priority' }) =>
    request(app)
      [path ? 'patch' : 'post'](`/api/v1/vendors/${f.vendorId}/resources/labels${path}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send(body);
  return {
    ...f,
    call,
    native,
    create: (title = 'Priority') =>
      call('/create-label', { title, text_color: '#fff', bg_color: '#012345' }),
  };
}
describe('original label-management API adapters and shared native mutations', () => {
  it('creates, edits and deletes source-named labels and their assignments with atomic audits', async () => {
    const f = await fixture(),
      created = await f.create();
    expect(created.status).toBe(201);
    expect(created.body.createdLabel).toMatchObject({
      title: 'Priority',
      text_color: '#fff',
      bg_color: '#012345',
      status: 1,
    });
    const label = created.body.createdLabel;
    expect(label.vendorId).toBeUndefined();
    expect(label.__data).toBeUndefined();
    const contact = await db.contacts.create({
      data: { vendorId: f.vendorId, assignedUserId: f.userId },
    });
    await db.contactLabels.create({ data: { contactId: contact.id, labelsId: label._id } });
    expect(
      (
        await f.call('/chat/edit-label', {
          labelUid: label._uid,
          title: 'Urgent',
          text_color: '#abcd',
          bg_color: null,
        })
      ).status,
    ).toBe(200);
    const stored = await db.labels.findUniqueOrThrow({ where: { id: label._id } });
    expect(stored.title).toBe('Urgent');
    expect(stored.textColor).toBe('#abcd');
    expect(stored.bgColor).toBeNull();
    expect(
      (await f.call(`/chat/delete-label/${label._uid}`, { labelUid: label._uid })).status,
    ).toBe(200);
    expect(await db.labels.count({ where: { id: label._id } })).toBe(0);
    expect(await db.contactLabels.count({ where: { contactId: contact.id } })).toBe(0);
    const events = await db.auditEvents.findMany({
      where: { vendorId: f.vendorId, resource: 'Labels' },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['create', 'update', 'delete']);
    expect(events[2].metadata).toMatchObject({ removedAssignments: 1 });
  });
  it('shares title uniqueness across original and native creates and edits', async () => {
    const f = await fixture();
    const responses = await Promise.all([f.create(), f.native()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const second = (await f.create('Second')).body.createdLabel;
    expect(
      (await f.call('/chat/edit-label', { labelUid: second._uid, title: 'Priority' })).status,
    ).toBe(409);
    expect((await f.native(`/${second._id}`, { title: 'Priority' })).status).toBe(409);
    expect(
      (await f.native(`/${second._id}`, { textColor: '#11223344', color: '#123', status: 2 }))
        .status,
    ).toBe(200);
    expect((await db.labels.findUniqueOrThrow({ where: { id: second._id } })).title).toBe('Second');
    expect(await db.labels.count({ where: { vendorId: f.vendorId } })).toBe(2);
  });
  it('isolates vendors and rejects conflicting URL/body label IDs', async () => {
    const f = await fixture(),
      other = await fixture(),
      label = (await f.create()).body.createdLabel;
    const foreign = (await other.create()).body.createdLabel;
    expect(
      (await other.call('/chat/edit-label', { labelUid: label._uid, title: 'Stolen' })).status,
    ).toBe(404);
    expect((await other.call(`/chat/delete-label/${label._uid}`)).status).toBe(404);
    expect(
      (await f.call(`/chat/delete-label/${label._uid}`, { labelUid: foreign._uid })).status,
    ).toBe(400);
    expect(await db.labels.count({ where: { id: label._id } })).toBe(1);
  });
  it('requires group management and full visibility for catalog mutations', async () => {
    for (const permissions of [
      ['vendor.contacts.view', 'vendor.contacts.edit'],
      ['vendor.groups.manage', 'vendor.contacts.view'],
    ]) {
      const f = await fixture(permissions);
      expect((await f.create()).status).toBe(403);
      expect((await f.native()).status).toBe(403);
    }
    const f = await fixture([
      'vendor.groups.manage',
      'vendor.chats.view_all',
      'vendor.contacts.view',
    ]);
    expect((await f.create()).status).toBe(201);
    expect(
      (await request(app).post(`${base}/create-label`).send({ title: 'Unowned' })).status,
    ).toBe(401);
  });
  it('validates source and native input without accepting server-owned or unsafe styling fields', async () => {
    const f = await fixture();
    for (const body of [
      { title: '' },
      { title: 'x'.repeat(46) },
      { title: 'Valid', text_color: 'url(x)' },
      { title: 'Valid', bg_color: 'red' },
      { title: 'Valid', vendors__id: f.vendorId },
      { title: 'Valid', status: 2 },
    ])
      expect((await f.call('/create-label', body)).status).toBe(400);
    expect((await f.native('', { title: 'Valid', textColor: 'url(x)' })).status).toBe(400);
    expect((await f.native('', { title: 'Valid', status: 99 })).status).toBe(400);
    expect((await f.call('/chat/edit-label', { labelUid: 12, title: 'Bad' })).status).toBe(400);
  });
  it('rolls back create, update and deletion if their audit write fails', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    const failAudit = () =>
      vi.spyOn(db, '$transaction').mockImplementationOnce(((callback: any) =>
        transaction(async (tx) => {
          const delegate = {
            ...tx.auditEvents,
            create: async () => {
              throw new Error('audit unavailable');
            },
          };
          const wrapped = new Proxy(tx, {
            get(target, key, receiver) {
              return key === 'auditEvents' ? delegate : Reflect.get(target, key, receiver);
            },
          });
          return callback(wrapped);
        })) as any);
    failAudit();
    expect((await f.create()).status).toBe(500);
    expect(await db.labels.count({ where: { vendorId: f.vendorId } })).toBe(0);
    const label = (await f.create()).body.createdLabel;
    failAudit();
    expect((await f.call('/chat/edit-label', { labelUid: label._uid, title: 'New' })).status).toBe(
      500,
    );
    expect((await db.labels.findUniqueOrThrow({ where: { id: label._id } })).title).toBe(
      'Priority',
    );
    const contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    await db.contactLabels.create({ data: { contactId: contact.id, labelsId: label._id } });
    failAudit();
    expect((await f.call(`/chat/delete-label/${label._uid}`)).status).toBe(500);
    expect(await db.labels.count({ where: { id: label._id } })).toBe(1);
    expect(await db.contactLabels.count({ where: { labelsId: label._id } })).toBe(1);
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, resource: 'Labels' } }),
    ).toBe(1);
  });
  it('rejects imported links to foreign contacts before deleting any local assignments', async () => {
    const f = await fixture(),
      other = await fixture(),
      label = (await f.create()).body.createdLabel;
    const local = await db.contacts.create({ data: { vendorId: f.vendorId } }),
      foreign = await db.contacts.create({ data: { vendorId: other.vendorId } });
    await db.contactLabels.createMany({
      data: [
        { contactId: local.id, labelsId: label._id },
        { contactId: foreign.id, labelsId: label._id },
      ],
    });
    const result = await f.call(`/chat/delete-label/${label._uid}`);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('LABEL_SCOPE_PENDING');
    expect(await db.contactLabels.count({ where: { labelsId: label._id } })).toBe(2);
    expect(await db.labels.count({ where: { id: label._id } })).toBe(1);
  });
  it('serializes label deletion against assignments without leaving orphan links', async () => {
    const f = await fixture(),
      label = (await f.create()).body.createdLabel;
    const contact = await db.contacts.create({
      data: { vendorId: f.vendorId, assignedUserId: f.userId },
    });
    const results = await Promise.all([
      f.call('/chat/assign-labels', { contactUid: contact.uid, contact_labels: [label._id] }),
      f.call(`/chat/delete-label/${label._uid}`),
    ]);
    expect([200, 400, 409]).toContain(results[0].status);
    expect(results[1].status).toBe(200);
    expect(await db.labels.count({ where: { id: label._id } })).toBe(0);
    expect(await db.contactLabels.count({ where: { labelsId: label._id } })).toBe(0);
  });
});
