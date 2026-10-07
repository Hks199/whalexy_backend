import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { decrypt, encrypt } from '../src/utils/crypto.js';
import { accessToken } from '../src/middleware/auth.js';
import { config } from '../src/config/environment.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { runOneJob } from '../src/jobs/runner.js';
import { dispatchDueCampaigns } from '../src/modules/campaigns/services/campaign-delivery.service.js';
const app = createApp();
const run = randomUUID().slice(0, 8),
  password = 'ThisIsAStrongTestPassword!42';
let a: {
    userId: number;
    vendorId: number;
    token: string;
    refreshToken: string;
    challengeId: string;
  },
  b: typeof a;
let aContact: number, bContact: number, agentUserId: number, agentToken: string;
async function account(label: string) {
  const email = `${label}-${run}@example.com`;
  const registered = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: label,
      email,
      password,
      phoneNumber: '+919876543210',
      businessName: `${label} project`,
    });
  expect(registered.status).toBe(201);
  const userId = registered.body.userId;
  await db.users.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() },
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(login.status).toBe(200);
  return {
    userId,
    vendorId: registered.body.vendorId,
    token: login.body.accessToken,
    refreshToken: login.body.refreshToken,
    challengeId: registered.body.challengeId,
  };
}
const endpoint = (vendorId: number, path: string) => `/api/v1/vendors/${vendorId}/${path}`;
const bearer = (token: string) => `Bearer ${token}`;
beforeAll(async () => {
  await db.$connect();
  a = await account('owner-a');
  b = await account('owner-b');
  const aa = await request(app)
    .post(endpoint(a.vendorId, 'contacts'))
    .set('Authorization', bearer(a.token))
    .send({ firstName: 'Alice', phone: '+919876500001' });
  expect(aa.status).toBe(201);
  aContact = aa.body.id;
  const bb = await request(app)
    .post(endpoint(b.vendorId, 'contacts'))
    .set('Authorization', bearer(b.token))
    .send({ firstName: 'Bob', phone: '+919876500002' });
  expect(bb.status).toBe(201);
  bContact = bb.body.id;
  const agent = await account('agent');
  agentUserId = agent.userId;
  agentToken = agent.token;
  await db.nativeMemberships.create({
    data: {
      vendorId: a.vendorId,
      userId: agentUserId,
      role: 'agent',
      permissions: ['vendor.contacts.view', 'vendor.chats.view_assigned', 'vendor.chats.reply'],
    },
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});
describe('PostgreSQL authentication and tenancy', () => {
  it('applied every Prisma source-derived table', async () => {
    const r = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`;
    expect(Number(r[0].count)).toBeGreaterThanOrEqual(129);
  });
  it('blocks users from another business', async () =>
    expect(
      (
        await request(app)
          .get(endpoint(b.vendorId, 'contacts'))
          .set('Authorization', bearer(a.token))
      ).status,
    ).toBe(403));
  it('hides a foreign contact even from an owner', async () =>
    expect(
      (
        await request(app)
          .get(endpoint(a.vendorId, `contacts/${bContact}`))
          .set('Authorization', bearer(a.token))
      ).status,
    ).toBe(404));
  it('rejects cross-business ownership fields', async () =>
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, 'resources/groups'))
          .set('Authorization', bearer(a.token))
          .send({ title: 'Injected group', vendorId: b.vendorId })
      ).status,
    ).toBe(400));
  it('restricts an agent to assigned contacts', async () => {
    const r = await request(app)
      .get(endpoint(a.vendorId, 'contacts'))
      .set('Authorization', bearer(agentToken));
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    expect(
      (
        await request(app)
          .get(endpoint(a.vendorId, `contacts/${aContact}`))
          .set('Authorization', bearer(agentToken))
      ).status,
    ).toBe(404);
  });
  it('allows a valid assignment and masks phone numbers', async () => {
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, `contacts/${aContact}/assign`))
          .set('Authorization', bearer(a.token))
          .send({ userId: agentUserId })
      ).status,
    ).toBe(204);
    const r = await request(app)
      .get(endpoint(a.vendorId, `contacts/${aContact}`))
      .set('Authorization', bearer(agentToken));
    expect(r.status).toBe(200);
    expect(r.body.waId).toMatch(/^\*\*\*/);
    expect(r.body.waId).not.toBe('919876500001');
  });
  it('does not let an agent change team permissions', async () =>
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, 'team'))
          .set('Authorization', bearer(agentToken))
          .send({ userId: b.userId, permissions: ['vendor.team.edit'] })
      ).status,
    ).toBe(403));
  it('limits API keys to their granted permissions, business and revocation state', async () => {
    const created = await request(app)
      .post(endpoint(a.vendorId, 'team/api-keys'))
      .set('Authorization', bearer(a.token))
      .send({
        permissions: ['vendor.contacts.view', 'vendor.chats.view_all'],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(created.status).toBe(201);
    const authorization = `ApiKey ${created.body.token}`;
    expect(
      (await request(app).get(endpoint(a.vendorId, 'contacts')).set('Authorization', authorization))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, 'contacts'))
          .set('Authorization', authorization)
          .send({ firstName: 'Blocked', phone: '+919876500003' })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get(endpoint(b.vendorId, 'contacts')).set('Authorization', authorization))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .delete(endpoint(a.vendorId, `team/api-keys/${created.body.id}`))
          .set('Authorization', bearer(a.token))
      ).status,
    ).toBe(204);
    expect(
      (await request(app).get(endpoint(a.vendorId, 'contacts')).set('Authorization', authorization))
        .status,
    ).toBe(401);
  });
  it('does not expose private integration tokens', async () => {
    await db.integrationCredentials.create({
      data: {
        vendorId: a.vendorId,
        provider: 'whatsapp',
        externalId: `12345${a.vendorId}`,
        secret: encrypt('private-access-token'),
      },
    });
    const r = await request(app)
      .get(endpoint(a.vendorId, 'integrations'))
      .set('Authorization', bearer(a.token));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('private-access-token');
    expect(r.body[0].secret).toBeUndefined();
  });
  it('fails closed on missing AI entitlement', async () =>
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, 'ai/reply'))
          .set('Authorization', bearer(a.token))
          .send({ contactId: aContact, message: 'Hello' })
      ).status,
    ).toBe(403));
  it('revokes a token after logout', async () => {
    const user = await account('logout');
    expect(
      (await request(app).post('/api/v1/auth/logout').set('Authorization', bearer(user.token)))
        .status,
    ).toBe(204);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', bearer(user.token))).status,
    ).toBe(401);
  });
  it('detects refresh-token reuse and revokes the token family', async () => {
    const user = await account('replay'),
      r = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(r.status).toBe(200);
    expect(
      (await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', bearer(r.body.accessToken)))
        .status,
    ).toBe(401);
  });
});
describe('verification, signed webhooks and message jobs', () => {
  it('requires contact verification and consumes email codes once', async () => {
    const email = `pending-${run}@example.com`,
      r = await request(app).post('/api/v1/auth/register').send({
        name: 'Pending',
        email,
        password,
        phoneNumber: '+919876543210',
        businessName: 'Pending business',
      });
    expect(r.status).toBe(201);
    expect((await request(app).post('/api/v1/auth/login').send({ email, password })).status).toBe(
      403,
    );
    const jobs = await db.outboxJobs.findMany({ where: { kind: 'email' } });
    const message = jobs
      .map((j) => JSON.parse(decrypt((j.payload as any).envelope)))
      .find((e) => e.challengeId === r.body.challengeId);
    expect(message).toBeTruthy();
    const input = { challengeId: r.body.challengeId, code: message.code };
    expect((await request(app).post('/api/v1/auth/verify-email').send(input)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/verify-email').send(input)).status).toBe(400);
  });
  it('persists signed webhook deliveries only once', async () => {
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      sig = createHmac('sha256', config.META_APP_SECRET).update(raw).digest('hex');
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(app)
            .post('/webhooks/meta')
            .set('Content-Type', 'application/json')
            .set('X-Hub-Signature-256', `sha256=${sig}`)
            .send(raw)
        ).status,
      ).toBe(200);
    expect(
      await db.webhookReceipts.count({
        where: { provider: 'meta', payload: { equals: JSON.parse(raw) } },
      }),
    ).toBe(1);
  });
  it('deduplicates incoming messages and prevents status regression', async () => {
    const phone = `12345${a.vendorId}`,
      id = `wamid-${run}`;
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phone },
                messages: [
                  {
                    id,
                    from: '919876500001',
                    type: 'text',
                    text: { body: 'Hello' },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    await ingestMeta(body);
    await ingestMeta(body);
    expect(
      await db.whatsappMessageLogs.count({
        where: { vendorId: a.vendorId, whatsappMessageId: id },
      }),
    ).toBe(1);
    for (const status of ['read', 'delivered', 'sent'])
      await ingestMeta({
        entry: [
          {
            changes: [
              { value: { metadata: { phone_number_id: phone }, statuses: [{ id, status }] } },
            ],
          },
        ],
      });
    expect(
      (await db.whatsappMessageLogs.findFirst({ where: { whatsappMessageId: id } }))?.status,
    ).toBe('read');
  });
  it('queues a send once and rejects idempotency-key conflicts', async () => {
    const input = {
        contactId: aContact,
        phoneNumberId: `12345${a.vendorId}`,
        kind: 'text',
        text: 'Queued message',
      },
      key = `send-${run}`;
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(app)
            .post(endpoint(a.vendorId, 'messages/send'))
            .set('Authorization', bearer(a.token))
            .set('Idempotency-Key', key)
            .send(input)
        ).status,
      ).toBe(202);
    expect(await db.outboxJobs.count({ where: { dedupeKey: `send:${a.vendorId}:${key}` } })).toBe(
      1,
    );
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, 'messages/send'))
          .set('Authorization', bearer(a.token))
          .set('Idempotency-Key', key)
          .send({ ...input, text: 'Different' })
      ).status,
    ).toBe(409);
  });
  it('does not send arbitrary free-form messages outside the service window', async () => {
    await db.contacts.update({ where: { id: aContact }, data: { messagedAt: new Date(0) } });
    await db.whatsappMessageLogs.updateMany({
      where: { vendorId: a.vendorId, contactId: aContact, isIncomingMessage: true },
      data: { messagedAt: new Date(0) },
    });
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, 'messages/send'))
          .set('Authorization', bearer(a.token))
          .set('Idempotency-Key', `old-${run}`)
          .send({
            contactId: aContact,
            phoneNumberId: `12345${a.vendorId}`,
            kind: 'text',
            text: 'Out of window',
          })
      ).status,
    ).toBe(409);
  });
});
describe('transactional resource booking', () => {
  it('blocks invalid campaigns without preventing subsequent dispatch', async () => {
    const template = await db.whatsappTemplates.create({
      data: {
        vendorId: a.vendorId,
        templateId: `tpl-${run}`,
        templateName: 'test_template',
        languageCode: 'en',
        status: 'APPROVED',
        data: { components: [{ type: 'BODY', text: 'Dispatch test' }] },
      },
    });
    const group = await db.contactGroups.create({
      data: { vendorId: a.vendorId, title: 'Empty campaign group' },
    });
    const base = {
      vendorId: a.vendorId,
      templateId: template.id,
      title: 'Dispatch test',
      status: 'scheduled',
      scheduledAt: new Date(0),
    };
    const invalid = await db.campaigns.create({
      data: { ...base, data: { groupIds: [group.id], phoneNumberId: '9999999999' } },
    });
    const valid = await db.campaigns.create({
      data: { ...base, data: { groupIds: [group.id], phoneNumberId: `12345${a.vendorId}` } },
    });
    await dispatchDueCampaigns(a.vendorId);
    expect((await db.campaigns.findUnique({ where: { id: invalid.id } }))?.status).toBe('blocked');
    expect((await db.campaigns.findUnique({ where: { id: valid.id } }))?.status).toBe('completed');
  });
  it('claims a slot once under concurrent booking requests', async () => {
    const s = await db.whalexyAppointmentServices.create({
        data: { vendorId: a.vendorId, name: 'Consultation', durationMinutes: 30 },
      }),
      r = await db.whalexyAppointmentResources.create({
        data: { vendorId: a.vendorId, name: 'Staff', timezone: 'UTC' },
      });
    await db.whalexyAppointmentServiceResources.create({
      data: { vendorId: a.vendorId, appointmentServiceId: s.id, appointmentResourceId: r.id },
    });
    await db.whalexyAppointmentSchedules.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        vendorId: a.vendorId,
        appointmentResourceId: r.id,
        weekday: i + 1,
        startLocalTime: '00:00:00',
        endLocalTime: '23:59:00',
      })),
    });
    const startsAt = new Date(Date.now() + 86400_000);
    startsAt.setUTCHours(10, 0, 0, 0);
    const body = {
      serviceId: s.id,
      resourceId: r.id,
      contactId: aContact,
      startsAt: startsAt.toISOString(),
    };
    const results = await Promise.all(
      [1, 2].map((i) =>
        request(app)
          .post(endpoint(a.vendorId, 'appointments'))
          .set('Authorization', bearer(a.token))
          .send({ ...body, idempotencyKey: `booking-${run}-${i}` }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const ok = results.find((r) => r.status === 201)!;
    expect(await db.nativeBookingClaims.count({ where: { appointmentId: ok.body.id } })).toBe(30);
    expect(
      (
        await request(app)
          .post(endpoint(a.vendorId, `appointments/${ok.body.id}/cancel`))
          .set('Authorization', bearer(a.token))
      ).status,
    ).toBe(204);
    expect(await db.nativeBookingClaims.count({ where: { appointmentId: ok.body.id } })).toBe(0);
  });
  it('rejects cross-business appointment resources', async () => {
    const r = await request(app)
      .post(endpoint(a.vendorId, 'appointments/service-resources'))
      .set('Authorization', bearer(a.token))
      .send({ serviceId: 2147483647, resourceId: 2147483647 });
    expect(r.status).toBe(404);
  });
});
