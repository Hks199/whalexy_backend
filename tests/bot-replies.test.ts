import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config/environment.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { createApp } from '../src/app.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { triggerMatches } from '../src/modules/bot-replies/services/reply-runtime.service.js';
import { withinBotTiming } from '../src/modules/bot-flows/services/bot-timing.js';
import { detectEscalation } from '../src/modules/handoffs/services/handoffs.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
const previousAi = { url: config.WHALEXY_AI_SERVICE_URL, key: config.WHALEXY_AI_API_KEY };
afterEach(() => {
  vi.unstubAllGlobals();
  config.WHALEXY_AI_SERVICE_URL = previousAi.url;
  config.WHALEXY_AI_API_KEY = previousAi.key;
});
afterAll(async () => db.$disconnect());
async function fixture() {
  const owner = await businessFixture(),
    phone = `5599${owner.vendorId}`,
    waId = `9199${String(owner.vendorId).padStart(7, '0')}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: owner.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-bot-credential'),
    },
  });
  const contact = await db.contacts.create({
    data: { vendorId: owner.vendorId, waId, firstName: 'Customer' },
  });
  return {
    ...owner,
    phone,
    contact,
    auth: `Bearer ${owner.token}`,
    prefix: `/api/v1/vendors/${owner.vendorId}`,
  };
}
async function bot(
  f: Awaited<ReturnType<typeof fixture>>,
  type = 'is',
  trigger = 'hello',
  reply = 'Hi {first_name}',
  extra = {},
) {
  const result = await request(app)
    .post(`${f.prefix}/bot-replies`)
    .set('Authorization', f.auth)
    .send({
      name: randomUUID(),
      triggerType: type,
      replyTrigger: trigger,
      replyText: reply,
      enabled: true,
      phoneNumberId: f.phone,
      ...extra,
    });
  expect(result.status).toBe(201);
  return result.body;
}
const inbound = (
  f: Awaited<ReturnType<typeof fixture>>,
  text: string,
  id = randomUUID(),
  timestamp = String(Math.floor(Date.now() / 1000)),
) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: f.phone },
            messages: [{ id, from: f.contact.waId, type: 'text', text: { body: text }, timestamp }],
          },
        },
      ],
    },
  ],
});
async function jobs(f: Awaited<ReturnType<typeof fixture>>) {
  return db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
}
describe('source trigger matching', () => {
  it.each([
    ['is', 'hello*', ' HELLO there ', true],
    ['is', 'h?llo', 'hello', false],
    ['starts_with', 'hello', 'Hello there', true],
    ['ends_with', 'bye', 'Goodbye', true],
    ['contains', 'ship', 'Shipping', true],
    ['contains_word', 'ship', 'Shipping', false],
    ['contains_word', 'ship', 'Please ship!', true],
    ['contains_word', 'a+b', 'a+b please', true],
    ['contains_word', 'नमस्ते', 'नमस्ते दोस्त', true],
    ['stop_promotional', 'stop', 'STOP', true],
  ])('matches %s / %s against %s', (type, pattern, text, expected) =>
    expect(triggerMatches(type, pattern, text)).toBe(expected),
  );
  it('requires first inbound for welcome and no active flow for new-message', () => {
    expect(triggerMatches('welcome', '', 'Hello', true)).toBe(true);
    expect(triggerMatches('welcome', '', 'Hello', false)).toBe(false);
    expect(triggerMatches('new_message', '', 'Hello', false, true)).toBe(false);
  });
  it('evaluates overnight timing in the business timezone', () => {
    expect(
      withinBotTiming(new Date('2026-10-02T19:00:00Z'), 'Asia/Kolkata', '23:00', '02:00'),
    ).toBe(true);
    expect(
      withinBotTiming(new Date('2026-10-02T12:00:00Z'), 'Asia/Kolkata', '23:00', '02:00'),
    ).toBe(false);
    expect(withinBotTiming(new Date(), 'Bad/Timezone', '09:00', '18:00')).toBe(false);
  });
  it.each([
    ['OTP is 123456', 'sensitive_information'],
    ['send payment qr', 'payment_qr_request'],
    ['पेमेंट क्यूआर भेजो', 'payment_qr_request'],
    ['my account was hacked', 'security_or_fraud'],
    ['can I talk to a real person', 'human_requested'],
  ])('detects escalation for %s', (message, reason) =>
    expect(detectEscalation(message)?.reason).toBe(reason),
  );
});
describe('durable standalone bot replies', () => {
  it('does not let malformed or far-future timestamps open a send window', async () => {
    const f = await fixture();
    await bot(f);
    for (const timestamp of ['invalid', String(Math.floor(Date.now() / 1000) + 3600)])
      await ingestMeta(inbound(f, 'hello', randomUUID(), timestamp));
    expect(await jobs(f)).toHaveLength(0);
    const sent = await request(app)
      .post(`${f.prefix}/messages/send`)
      .set('Authorization', f.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ contactId: f.contact.id, phoneNumberId: f.phone, kind: 'text', text: 'Hello' });
    expect(sent.status).toBe(409);
  });
  it('suppresses new-message rules only for flows owned by this business', async () => {
    const f = await fixture(),
      foreign = await businessFixture();
    await bot(f, 'new_message', '', 'Fallback');
    const flow = await db.botFlows.create({
      data: { vendorId: foreign.vendorId, title: 'Foreign flow' },
    });
    await db.userActiveFlows.create({ data: { flowId: flow.id, phoneNumber: f.contact.waId } });
    await ingestMeta(inbound(f, 'one'));
    expect(await jobs(f)).toHaveLength(1);
    const owned = await db.botFlows.create({ data: { vendorId: f.vendorId, title: 'Owned flow' } });
    await db.userActiveFlows.create({ data: { flowId: owned.id, phoneNumber: f.contact.waId } });
    await ingestMeta(inbound(f, 'two'));
    expect(await jobs(f)).toHaveLength(1);
  });
  it('validates timing settings and restricts only selected trigger types', async () => {
    const f = await fixture();
    await bot(f);
    const local = new Date(),
      start = (local.getUTCHours() + 2) % 24,
      end = (local.getUTCHours() + 3) % 24;
    const settings = {
      enabled: true,
      timezone: 'UTC',
      startsAt: `${String(start).padStart(2, '0')}:00`,
      endsAt: `${String(end).padStart(2, '0')}:00`,
      triggerTypes: ['is'],
    };
    expect(
      (
        await request(app)
          .put(`${f.prefix}/bot-replies/settings/timing`)
          .set('Authorization', f.auth)
          .send({ ...settings, timezone: 'Invalid/Zone' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put(`${f.prefix}/bot-replies/settings/timing`)
          .set('Authorization', f.auth)
          .send(settings)
      ).status,
    ).toBe(204);
    await ingestMeta(inbound(f, 'hello'));
    expect(await jobs(f)).toHaveLength(0);
    await bot(f, 'starts_with', 'hello', 'Unrestricted');
    await ingestMeta(inbound(f, 'hello there'));
    expect(await jobs(f)).toHaveLength(1);
  });
  it('renders tenant custom/contact values once across duplicate inbound events', async () => {
    const f = await fixture(),
      field = await db.contactCustomFields.create({
        data: { vendorId: f.vendorId, inputName: 'reference', inputType: 'text' },
      });
    await db.contactCustomFieldValues.create({
      data: { contactId: f.contact.id, contactCustomFieldsId: field.id, fieldValue: 'REF-7' },
    });
    await bot(f, 'is', 'hello,hi', 'Hello {first_name}, {reference}');
    const event = inbound(f, ' HI ');
    await ingestMeta(event);
    await ingestMeta(event);
    const queue = await jobs(f);
    expect(queue).toHaveLength(1);
    expect(queue[0].payload).toMatchObject({
      payload: { text: { body: 'Hello Customer, REF-7' } },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.bot.${f.vendorId}` }] })),
        ),
    );
    await processJob(queue[0]);
    await processJob(queue[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent first messages and emits welcome only once', async () => {
    const f = await fixture();
    await bot(f, 'welcome', '', 'Welcome');
    await Promise.all([ingestMeta(inbound(f, 'one')), ingestMeta(inbound(f, 'two'))]);
    expect(await jobs(f)).toHaveLength(1);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId, waId: f.contact.waId } })).toBe(
      1,
    );
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).unreadMessagesCount,
    ).toBe(2);
  });
  it('records stop/start consent and AI toggles from configured triggers', async () => {
    const f = await fixture();
    await bot(f, 'stop_promotional', 'stop', '');
    await bot(f, 'start_promotional', 'start', '');
    await bot(f, 'stop_ai_bot', 'ai off', '');
    await bot(f, 'start_ai_bot', 'ai on', '');
    await ingestMeta(inbound(f, 'STOP'));
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).whatsappOptOut,
    ).toBe(1);
    await ingestMeta(inbound(f, 'start'));
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).whatsappOptOut,
    ).toBeNull();
    await ingestMeta(inbound(f, 'ai off'));
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).disableAiBot,
    ).toBe(1);
    await ingestMeta(inbound(f, 'ai on'));
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).disableAiBot,
    ).toBe(0);
  });
  it('keeps consent active while away replies own the conversation', async () => {
    const f = await fixture();
    await bot(f, 'stop_promotional', 'stop', 'Consent reply');
    await db.outOfOfficeSettings.create({
      data: {
        vendorId: f.vendorId,
        whatsappPhoneNumberId: f.phone,
        enabled: true,
        message: 'Away',
        mode: 'out_of_office_now',
        manualStartedAt: new Date(),
      },
    });
    await ingestMeta(inbound(f, 'stop'));
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).whatsappOptOut,
    ).toBe(1);
    expect(await jobs(f)).toHaveLength(1);
    expect((await jobs(f))[0].payload).toHaveProperty('awayDeliveryId');
  });
  it('suppresses disabled, foreign-number and expired-event replies', async () => {
    const f = await fixture();
    await bot(f, 'is', 'hello', 'Disabled', { enabled: false });
    await ingestMeta(inbound(f, 'hello'));
    expect(await jobs(f)).toHaveLength(0);
    const active = await bot(f, 'is', 'other', 'Active');
    await ingestMeta(inbound(f, 'other', randomUUID(), '0'));
    expect(await jobs(f)).toHaveLength(0);
    const another = `7788${f.vendorId}`;
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: another,
        secret: encrypt('other-test'),
      },
    });
    await ingestMeta(inbound({ ...f, phone: another }, 'other'));
    expect(await jobs(f)).toHaveLength(0);
    expect(active.data.phoneNumberId).toBe(f.phone);
  });
  it('cancels a queued reply after a rule edit before dispatch', async () => {
    const f = await fixture(),
      rule = await bot(f);
    await ingestMeta(inbound(f, 'hello'));
    const queued = (await jobs(f))[0];
    await db.botReplies.update({
      where: { id: rule.id },
      data: { status: 2, updatedAt: new Date() },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(queued);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (queued.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
  });
  it('retains unsupported rich bot data as a blocked job', async () => {
    const f = await fixture(),
      rule = await bot(f);
    await db.botReplies.update({
      where: { id: rule.id },
      data: { data: { media_message: { type: 'image' } } },
    });
    await ingestMeta(inbound(f, 'hello'));
    expect(await jobs(f)).toHaveLength(0);
    expect(
      await db.outboxJobs.findFirst({
        where: { vendorId: f.vendorId, status: 'blocked', kind: 'bot-reply-unsupported' },
      }),
    ).toBeTruthy();
  });
  it('validates bot definitions, rejects cross-business access and protects names', async () => {
    const f = await fixture(),
      foreign = await businessFixture(),
      rule = await bot(f);
    expect(
      (
        await request(app)
          .get(`${f.prefix}/bot-replies`)
          .set('Authorization', `Bearer ${foreign.token}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app).post(`${f.prefix}/bot-replies`).set('Authorization', f.auth).send({
          name: rule.name,
          triggerType: 'is',
          replyTrigger: 'hello',
          replyText: 'Hi',
          enabled: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`${f.prefix}/bot-replies`)
          .set('Authorization', f.auth)
          .send({ name: 'Bad', triggerType: 'unknown', enabled: true, replyText: 'Hi' })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).delete(`${f.prefix}/bot-replies/${rule.id}`).set('Authorization', f.auth))
        .status,
    ).toBe(204);
  });
});
describe('human handoff ownership', () => {
  it('cancels an already queued away reply when a human handoff opens', async () => {
    const f = await fixture();
    await db.outOfOfficeSettings.create({
      data: {
        vendorId: f.vendorId,
        whatsappPhoneNumberId: f.phone,
        enabled: true,
        message: 'Away',
        mode: 'out_of_office_now',
        manualStartedAt: new Date(),
      },
    });
    await ingestMeta(inbound(f, 'hello'));
    const away = (await jobs(f))[0];
    expect(away.payload).toHaveProperty('awayDeliveryId');
    await ingestMeta(inbound(f, 'need a real person'));
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    await processJob(away);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (away.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
  });
  it('transfers to an active reply agent and rejects foreign or closed transfers', async () => {
    const f = await fixture(),
      agent = await businessFixture(['vendor.contacts.view', 'vendor.chats.reply']);
    await ingestMeta(inbound(f, 'need a human'));
    const h = await db.aiConversationHandoffs.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    const url = `${f.prefix}/handoffs/${h.id}`;
    expect(
      (
        await request(app)
          .post(`${url}/transfer`)
          .set('Authorization', f.auth)
          .send({ userId: agent.userId })
      ).status,
    ).toBe(400);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: agent.userId,
        role: 'agent',
        permissions: ['vendor.contacts.view', 'vendor.chats.reply'],
      },
    });
    expect(
      (
        await request(app)
          .post(`${url}/transfer`)
          .set('Authorization', f.auth)
          .send({ userId: agent.userId })
      ).status,
    ).toBe(204);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).assignedUserId,
    ).toBe(agent.userId);
    expect(
      (await request(app).get(`${f.prefix}/handoffs`).set('Authorization', `Bearer ${agent.token}`))
        .body,
    ).toHaveLength(1);
    await db.contacts.update({ where: { id: f.contact.id }, data: { assignedUserId: f.userId } });
    expect(
      (await request(app).get(`${f.prefix}/handoffs`).set('Authorization', `Bearer ${agent.token}`))
        .body,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .post(`${url}/resolve`)
          .set('Authorization', f.auth)
          .send({ resumeAi: true })
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post(`${url}/transfer`)
          .set('Authorization', f.auth)
          .send({ userId: agent.userId })
      ).status,
    ).toBe(409);
    await ingestMeta(inbound(f, 'need a human again'));
    expect(
      (
        await request(app)
          .post(`${url}/resolve`)
          .set('Authorization', f.auth)
          .send({ resumeAi: true })
      ).status,
    ).toBe(409);
    expect(
      await db.aiConversationHandoffs.count({ where: { vendorId: f.vendorId, status: 'waiting' } }),
    ).toBe(1);
  });
  it('opens one handoff, pauses automation and suppresses subsequent bot replies', async () => {
    const f = await fixture();
    await bot(f, 'new_message', '', 'Automatic');
    await ingestMeta(inbound(f, 'I need a real person'));
    await db.outOfOfficeSettings.create({
      data: {
        vendorId: f.vendorId,
        whatsappPhoneNumberId: f.phone,
        enabled: true,
        message: 'Away',
        mode: 'out_of_office_now',
        manualStartedAt: new Date(),
      },
    });
    await ingestMeta(inbound(f, 'support agent please'));
    await ingestMeta(inbound(f, 'hello'));
    const handoff = await db.aiConversationHandoffs.findFirstOrThrow({
      where: { vendorId: f.vendorId, contactId: f.contact.id },
    });
    expect(handoff.status).toBe('waiting');
    expect(handoff.assignedUserId).toBe(f.userId);
    expect(await db.aiConversationHandoffs.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await jobs(f)).toHaveLength(1);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).disableAiBot,
    ).toBe(1);
  });
  it('accepts only after successful human delivery and resolves on explicit AI resume', async () => {
    const f = await fixture();
    await ingestMeta(inbound(f, 'need a human'));
    const send = await request(app)
      .post(`${f.prefix}/messages/send`)
      .set('Authorization', f.auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        contactId: f.contact.id,
        phoneNumberId: f.phone,
        kind: 'text',
        text: 'A team member is here',
      });
    expect(send.status).toBe(202);
    const queued = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['messageId'], equals: send.body.id } },
    });
    expect(
      (await db.aiConversationHandoffs.findFirstOrThrow({ where: { vendorId: f.vendorId } }))
        .status,
    ).toBe('waiting');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.human.${f.vendorId}` }] })),
        ),
    );
    await processJob(queued);
    const accepted = await db.aiConversationHandoffs.findFirstOrThrow({
      where: { vendorId: f.vendorId },
    });
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedByUsersId).toBe(f.userId);
    await db.manualSubscriptions.create({ data: { vendorId: f.vendorId, status: 'active' } });
    await db.subscriptionAddons.create({
      data: {
        vendorId: f.vendorId,
        addonCode: 'ai_replies',
        price: 0,
        source: 'admin_override',
        status: 'active',
      },
    });
    config.WHALEXY_AI_SERVICE_URL = 'https://automation-provider.test';
    config.WHALEXY_AI_API_KEY = 'test-automation-key';
    const acknowledgement = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, enabled: true })));
    vi.stubGlobal('fetch', acknowledgement);

    expect(
      (
        await request(app)
          .post(`${f.prefix}/contacts/${f.contact.id}/ai`)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', randomUUID())
          .send({ enabled: true })
      ).status,
    ).toBe(204);
    expect(acknowledgement).toHaveBeenCalledTimes(1);
    expect(
      (await db.aiConversationHandoffs.findUniqueOrThrow({ where: { id: accepted.id } })).openKey,
    ).toBeNull();
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).disableAiBot,
    ).toBe(0);
  });
  it('cannot send a queued human message after membership is revoked', async () => {
    const f = await fixture();
    await ingestMeta(inbound(f, 'hello'));
    const send = await request(app)
      .post(`${f.prefix}/messages/send`)
      .set('Authorization', f.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ contactId: f.contact.id, phoneNumberId: f.phone, kind: 'text', text: 'Hello' });
    expect(send.status).toBe(202);
    const queued = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['messageId'], equals: send.body.id } },
    });
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: { active: false },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(processJob(queued)).rejects.toMatchObject({ code: 'SENDER_ACCESS_REVOKED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
