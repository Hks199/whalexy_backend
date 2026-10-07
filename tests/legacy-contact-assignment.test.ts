import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    other = await businessFixture();
  await db.nativeMemberships.create({
    data: {
      vendorId: f.vendorId,
      userId: other.userId,
      role: 'agent',
      permissions: ['vendor.chats.reply'],
    },
  });
  const agent = await db.users.findUniqueOrThrow({ where: { id: other.userId } });
  const group = await db.contactGroups.create({
    data: { vendorId: f.vendorId, title: 'Assigned group' },
  });
  const first = await db.contacts.create({
    data: { vendorId: f.vendorId, assignedUserId: f.userId, disableAiBot: 1 },
  });
  const second = await db.contacts.create({
    data: { vendorId: f.vendorId, assignedUserId: f.userId, disableAiBot: 0 },
  });
  await db.groupContacts.createMany({
    data: [
      { groupId: group.id, contactId: first.id },
      { groupId: group.id, contactId: second.id },
    ],
  });
  const handoff = await db.aiConversationHandoffs.create({
    data: {
      vendorId: f.vendorId,
      contactId: first.id,
      openKey: `${f.vendorId}:${first.id}`,
      status: 'accepted',
      assignedUserId: f.userId,
      acceptedByUsersId: f.userId,
      acceptedAt: new Date(),
      reason: 'human_requested',
      severity: 'normal',
      requestedAt: new Date(),
    },
  });
  const groupCall = (
    body: Record<string, unknown> = { group_uid: group.uid, agent_uid: agent.uid },
  ) =>
    request(app)
      .post('/vendor-console/contacts/groups/assign-agent-process')
      .set('Authorization', `Bearer ${f.token}`)
      .send(body);
  const chatCall = (
    body: Record<string, unknown> = { contactIdOrUid: first.uid, assigned_users_uid: agent.uid },
  ) =>
    request(app)
      .post('/vendor-console/whatsapp/contact/chat/assign-user')
      .set('Authorization', `Bearer ${f.token}`)
      .send(body);
  return { ...f, agent, group, first, second, handoff, groupCall, chatCall };
}
describe('original group and chat assignment with handoff consistency', () => {
  it('assigns all eligible group contacts and resets open handoffs without creating handoffs or pausing other AI', async () => {
    const f = await fixture(),
      result = await f.groupCall();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      assignedContactsCount: 2,
      reloadDatatableId: '#lwGroupList',
    });
    expect(
      await db.contacts.count({
        where: { id: { in: [f.first.id, f.second.id] }, assignedUserId: f.agent.id },
      }),
    ).toBe(2);
    const handoff = await db.aiConversationHandoffs.findUniqueOrThrow({
      where: { id: f.handoff.id },
    });
    expect(handoff).toMatchObject({
      status: 'waiting',
      assignedUserId: f.agent.id,
      acceptedAt: null,
      acceptedByUsersId: null,
    });
    expect(handoff.assignedAt).not.toBeNull();
    expect((await db.contacts.findUniqueOrThrow({ where: { id: f.first.id } })).disableAiBot).toBe(
      1,
    );
    expect((await db.contacts.findUniqueOrThrow({ where: { id: f.second.id } })).disableAiBot).toBe(
      0,
    );
    expect(await db.aiConversationHandoffs.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(
      await db.auditEvents.count({
        where: { vendorId: f.vendorId, resource: 'ContactGroups', action: 'assign' },
      }),
    ).toBe(1);
  });
  it('supports UUID chat assignment and source unassignment forms while preserving closed history', async () => {
    const f = await fixture();
    expect((await f.chatCall()).body).toMatchObject({
      contactUid: f.first.uid,
      currentlyAssignedUserUid: f.agent.uid,
    });
    const closed = await db.aiConversationHandoffs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.first.id,
        status: 'resolved',
        reason: 'historical',
        severity: 'normal',
        requestedAt: new Date(),
        resolvedAt: new Date(),
      },
    });
    for (const value of ['no_one', null, '', undefined]) {
      const result = await f.chatCall({
        contactIdOrUid: f.first.uid,
        ...(value === undefined ? {} : { assigned_users_uid: value }),
      });
      expect(result.status).toBe(200);
      expect(result.body.currentlyAssignedUserUid).toBeNull();
      const h = await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } });
      expect(h.assignedUserId).toBeNull();
      expect(h.assignedAt).toBeNull();
      expect(h.status).toBe('waiting');
    }
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: closed.id } })).status,
    ).toBe('resolved');
  });
  it('makes native single and group assignment use the same eligibility and handoff rules', async () => {
    const f = await fixture();
    const single = await request(app)
      .post(`/api/v1/vendors/${f.vendorId}/contacts/${f.first.id}/assign`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ userId: f.agent.id });
    expect(single.status).toBe(204);
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } }))
        .assignedUserId,
    ).toBe(f.agent.id);
    const bulk = await request(app)
      .post(`/api/v1/vendors/${f.vendorId}/groups/${f.group.id}/assign`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ userId: null });
    expect(bulk.status).toBe(200);
    expect(bulk.body.assignedContactsCount).toBe(2);
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } }))
        .assignedUserId,
    ).toBeNull();
  });
  it('rejects foreign/inactive/nonreply agents and leaves both assignment and handoff unchanged', async () => {
    const f = await fixture(),
      foreign = await businessFixture();
    const uid = (await db.users.findUniqueOrThrow({ where: { id: foreign.userId } })).uid;
    expect((await f.groupCall({ group_uid: f.group.uid, agent_uid: uid })).status).toBe(400);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.agent.id } },
      data: { permissions: ['vendor.contacts.view'] },
    });
    expect((await f.groupCall()).status).toBe(400);
    expect((await f.chatCall()).status).toBe(400);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.agent.id } },
      data: { permissions: ['vendor.chats.reply'] },
    });
    await db.users.update({ where: { id: f.agent.id }, data: { status: 2 } });
    expect((await f.groupCall()).status).toBe(400);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.first.id } })).assignedUserId,
    ).toBe(f.userId);
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } })).status,
    ).toBe('accepted');
  });
  it('requires current assignment permission and contact visibility for original routes', async () => {
    const f = await fixture(['vendor.contacts.view', 'vendor.chats.assign']);
    expect((await f.groupCall()).status).toBe(403);
    expect(
      (await f.chatCall({ contactIdOrUid: f.second.uid, assigned_users_uid: f.agent.uid })).status,
    ).toBe(200);
    const hidden = await db.contacts.create({ data: { vendorId: f.vendorId } });
    expect((await f.chatCall({ contactIdOrUid: hidden.uid })).status).toBe(404);
    const restricted = await fixture(['vendor.groups.manage', 'vendor.chats.view_all']);
    expect((await restricted.groupCall()).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/vendor-console/whatsapp/contact/chat/assign-user')
          .send({ contactIdOrUid: f.first.uid })
      ).status,
    ).toBe(401);
  });
  it('rejects archived groups and imported foreign links, while excluding inactive and wrong-phone contacts', async () => {
    const f = await fixture();
    await db.contactGroups.update({ where: { id: f.group.id }, data: { status: 5 } });
    expect((await f.groupCall()).status).toBe(409);
    await db.contactGroups.update({
      where: { id: f.group.id },
      data: { status: 1, wabPhoneNumberId: 'phone-a' },
    });
    await db.contacts.update({ where: { id: f.first.id }, data: { wabPhoneNumberId: 'phone-a' } });
    await db.contacts.update({ where: { id: f.second.id }, data: { wabPhoneNumberId: 'phone-b' } });
    expect((await f.groupCall()).body.assignedContactsCount).toBe(1);
    const other = await businessFixture(),
      contact = await db.contacts.create({ data: { vendorId: other.vendorId } });
    await db.groupContacts.create({ data: { groupId: f.group.id, contactId: contact.id } });
    expect((await f.groupCall()).body.error.code).toBe('GROUP_SCOPE_PENDING');
  });
  it('rolls back the entire group when open handoffs are ambiguous or auditing fails', async () => {
    const f = await fixture();
    const duplicate = await db.aiConversationHandoffs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.second.id,
        status: 'waiting',
        reason: 'one',
        severity: 'normal',
        requestedAt: new Date(),
      },
    });
    await db.aiConversationHandoffs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.second.id,
        status: 'accepted',
        reason: 'two',
        severity: 'normal',
        requestedAt: new Date(),
      },
    });
    expect((await f.groupCall()).body.error.code).toBe('HANDOFF_STATE');
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.first.id } })).assignedUserId,
    ).toBe(f.userId);
    await db.aiConversationHandoffs.deleteMany({
      where: { vendorId: f.vendorId, contactId: f.second.id, id: { not: duplicate.id } },
    });
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
    expect((await f.groupCall()).status).toBe(500);
    expect(
      await db.contacts.count({
        where: { id: { in: [f.first.id, f.second.id] }, assignedUserId: f.userId },
      }),
    ).toBe(2);
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } })).status,
    ).toBe('accepted');
  });
  it('rejects invalid source identifiers, extra ownership fields and oversized groups before writing', async () => {
    const f = await fixture();
    expect((await f.groupCall({ group_uid: 12, agent_uid: f.agent.uid })).status).toBe(400);
    expect((await f.chatCall({ contactIdOrUid: f.first.uid, assigned_users_uid: 12 })).status).toBe(
      400,
    );
    expect(
      (await f.chatCall({ contactIdOrUid: f.first.uid, vendors__id: f.vendorId })).status,
    ).toBe(400);
    const rows = await db.contacts.createManyAndReturn({
      data: Array.from({ length: 499 }, () => ({ vendorId: f.vendorId, uid: randomUUID() })),
      select: { id: true },
    });
    await db.groupContacts.createMany({
      data: rows.map((c) => ({ groupId: f.group.id, contactId: c.id })),
    });
    expect((await f.groupCall()).body.error.code).toBe('ASSIGNMENT_TOO_LARGE');
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.first.id } })).assignedUserId,
    ).toBe(f.userId);
  });
});
