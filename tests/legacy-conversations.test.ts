import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { businessFixture } from './fixtures.js';
import { acceptContactHandoff } from '../src/modules/handoffs/services/accept-contact-handoff.service.js';
import { digest } from '../src/utils/crypto.js';
const app = createApp(),
  base = '/vendor-console/conversations';
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      assignedUserId: f.userId,
      disableAiBot: 1,
      waId: '919876543210',
      email: 'private@example.com',
      conversationStatus: 'resolved',
      conversationResolutionSequence: 3,
      conversationResolvedAt: new Date(),
      conversationResolvedByUserId: f.userId,
    },
  });
  const handoff = await db.aiConversationHandoffs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      openKey: `${f.vendorId}:${contact.id}`,
      assignedUserId: f.userId,
      requestedAt: new Date(),
    },
  });
  const auth = { Authorization: `Bearer ${f.token}` };
  return { ...f, contact, handoff, auth };
}
describe('original conversation reopen and handoff APIs', () => {
  it('reopens UUID/numeric contacts while preserving scoring history, AI state and handoff', async () => {
    const f = await fixture(['vendor.chats.reply']);
    const score = await db.conversationCxScores.create({
      data: {
        vendorId: f.vendorId,
        conversationId: f.contact.id,
        resolutionSequence: 3,
        status: 'completed',
        cxScore: '8',
      },
    });
    for (const identifier of [f.contact.uid, f.contact.id]) {
      const result = await request(app).post(`${base}/${identifier}/reopen`).set(f.auth).send({});
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        status: 'open',
        conversation: {
          _uid: f.contact.uid,
          conversation_status: 'open',
          conversation_resolution_sequence: 3,
          conversation_resolved_at: null,
          conversation_resolved_by_user_id: null,
          disable_ai_bot: 1,
          wa_id: '***3210',
          email: null,
        },
      });
    }
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId, kind: 'cx-score' } })).toBe(
      0,
    );
    expect(
      (await db.conversationCxScores.findUniqueOrThrow({ where: { id: score.id } })).status,
    ).toBe('completed');
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } })).status,
    ).toBe('waiting');
  });
  it('accepts a handoff once under competing original and native requests and records the actor', async () => {
    const f = await fixture();
    const legacy = request(app)
      .post(`${base}/${f.contact.uid}/handoff/accept`)
      .set(f.auth)
      .send({});
    const native = request(app)
      .post(`/api/v1/vendors/${f.vendorId}/handoffs/contacts/${f.contact.id}/accept`)
      .set(f.auth)
      .send({});
    const results = await Promise.all([legacy, native]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const result = results.find((r) => r.status === 200)!;
    expect(result.body).toMatchObject({
      status: 'accepted',
      handoff: {
        uid: f.handoff.uid,
        status: 'accepted',
        assigned_user_id: f.userId,
        assigned_user_name: 'Test user',
        accepted_user_name: 'Test user',
        accepted_at: expect.any(String),
      },
    });
    const current = await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } });
    expect(current.disableAiBot).toBe(1);
    expect(current.assignedUserId).toBe(f.userId);
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: f.handoff.id } }))
        .acceptedByUsersId,
    ).toBe(f.userId);
    expect(
      await db.auditEvents.count({
        where: { vendorId: f.vendorId, resource: 'handoff', action: 'accept' },
      }),
    ).toBe(1);
  });
  it('enforces auth, reply permission, workspace selection and current assignment', async () => {
    const f = await fixture(),
      agent = await fixture(['vendor.chats.reply']),
      reader = await fixture(['vendor.contacts.view']);
    expect((await request(app).post(`${base}/${f.contact.uid}/reopen`).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`${base}/${reader.contact.uid}/handoff/accept`)
          .set(reader.auth)
          .send({})
      ).status,
    ).toBe(403);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: agent.userId,
        role: 'agent',
        permissions: ['vendor.chats.reply'],
      },
    });
    const accept = () =>
      request(app)
        .post(`${base}/${f.contact.uid}/handoff/accept`)
        .set(agent.auth)
        .set('X-Vendor-Id', String(f.vendorId))
        .send({});
    expect(
      (await request(app).post(`${base}/${f.contact.uid}/handoff/accept`).set(agent.auth).send({}))
        .status,
    ).toBe(409);
    expect((await accept()).status).toBe(404);
    await db.contacts.update({
      where: { id: f.contact.id },
      data: { assignedUserId: agent.userId },
    });
    expect((await accept()).status).toBe(200);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).assignedUserId,
    ).toBe(agent.userId);
    expect(
      (await request(app).post(`${base}/${agent.contact.uid}/reopen`).set(f.auth).send({})).status,
    ).toBe(404);
  });
  it('rejects inactive contacts and ambiguous imported handoffs without changing either record', async () => {
    const f = await fixture();
    await db.contacts.update({ where: { id: f.contact.id }, data: { status: 0 } });
    const accept = () =>
      request(app).post(`${base}/${f.contact.id}/handoff/accept`).set(f.auth).send({});
    expect((await accept()).status).toBe(409);
    await db.contacts.update({ where: { id: f.contact.id }, data: { status: 1 } });
    await db.contacts.update({ where: { id: f.contact.id }, data: { disableAiBot: 0 } });
    expect((await accept()).body.error.code).toBe('HANDOFF_AUTOMATION_STATE');
    await db.contacts.update({ where: { id: f.contact.id }, data: { disableAiBot: 1 } });
    await db.aiConversationHandoffs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contact.id,
        status: 'waiting',
        requestedAt: new Date(),
      },
    });
    expect((await accept()).status).toBe(409);
    expect(
      await db.aiConversationHandoffs.count({ where: { vendorId: f.vendorId, status: 'waiting' } }),
    ).toBe(2);
    expect(await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'accept' } })).toBe(
      0,
    );
  });
  it('rejects invalid identity/body fields and keeps accepted/closed handoffs closed', async () => {
    const f = await fixture();
    expect((await request(app).post(`${base}/bad-id/reopen`).set(f.auth).send({})).status).toBe(
      400,
    );
    expect(
      (
        await request(app)
          .post(`${base}/${f.contact.uid}/reopen`)
          .set(f.auth)
          .send({ enabled: true })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${base}/${f.contact.uid}/handoff/accept`)
          .set(f.auth)
          .send({ userId: f.userId })
      ).status,
    ).toBe(400);
    await db.aiConversationHandoffs.update({
      where: { id: f.handoff.id },
      data: { status: 'resolved', openKey: null },
    });
    expect(
      (await request(app).post(`${base}/${f.contact.uid}/handoff/accept`).set(f.auth).send({}))
        .status,
    ).toBe(409);
  });
  it('rechecks current membership and API-key expiry, revocation and permission intersection in the transaction', async () => {
    const f = await fixture();
    const key = await db.apiKeys.create({
      data: {
        vendorId: f.vendorId,
        userId: f.userId,
        keyHash: digest(`unused-test-key-${f.vendorId}`),
        permissions: ['vendor.contacts.view'],
      },
    });
    const input = {
      identity: {
        userId: f.userId,
        vendorId: f.vendorId,
        sessionId: 'test',
        permissions: ['*'],
        role: 'owner',
        apiKeyId: key.id,
      },
      body: {},
      params: { contactId: f.contact.id },
      headers: {},
      query: {},
    };
    await expect(acceptContactHandoff(input)).rejects.toMatchObject({ status: 403 });
    await db.apiKeys.update({
      where: { id: key.id },
      data: { permissions: ['vendor.chats.reply'], expiresAt: new Date(0) },
    });
    await expect(acceptContactHandoff(input)).rejects.toMatchObject({ status: 403 });
    await db.apiKeys.update({
      where: { id: key.id },
      data: { expiresAt: null, revokedAt: new Date() },
    });
    await expect(acceptContactHandoff(input)).rejects.toMatchObject({ status: 403 });
    await db.apiKeys.update({ where: { id: key.id }, data: { revokedAt: null } });
    await db.contacts.update({ where: { id: f.contact.id }, data: { assignedUserId: null } });
    await expect(acceptContactHandoff(input)).rejects.toMatchObject({ status: 404 });
    await db.contacts.update({ where: { id: f.contact.id }, data: { assignedUserId: f.userId } });
    expect((await acceptContactHandoff(input)).status).toBe(200);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: { active: false },
    });
    await expect(acceptContactHandoff(input)).rejects.toMatchObject({ status: 403 });
  });
});
