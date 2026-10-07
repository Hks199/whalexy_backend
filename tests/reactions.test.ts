import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { customerWindowOpen } from '../src/modules/messaging/services/whatsapp.js';
import { acknowledgeReaction, validReaction } from '../src/modules/messaging/services/reactions.js';
import { requestHandoff } from '../src/modules/handoffs/services/handoffs.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  thumb = '\u{1F44D}\u{1F3FD}',
  heart = '\u2764\uFE0F';
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    phone = `7755${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('reaction-test'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9195${String(f.vendorId).padStart(7, '0')}`,
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  const original = await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phone,
      whatsappMessageId: `wamid.${randomUUID()}`,
      type: 'text',
      isIncomingMessage: true,
      status: 'received',
      messagedAt: new Date(Date.now() - 10000),
      data: { incoming: { text: 'Original' }, reactions: { contact: heart } },
    },
  });
  return {
    ...f,
    phone,
    contact,
    original,
    auth: `Bearer ${f.token}`,
    path: `/api/v1/vendors/${f.vendorId}/messages/send`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const send = (f: Fixture, emoji = thumb, messageId = f.original.id, key = randomUUID()) =>
  request(app).post(f.path).set('Authorization', f.auth).set('Idempotency-Key', key).send({
    contactId: f.contact.id,
    phoneNumberId: f.phone,
    kind: 'reaction',
    reaction: { messageId, emoji },
  });
const jobs = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
const target = (f: Fixture) =>
  db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: f.original.id } });
const remote = () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: `wamid.reaction.${randomUUID()}` }] })),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const event = (
  f: Fixture,
  emoji = thumb,
  timestamp = Math.floor(Date.now() / 1000),
  extra: any = {},
) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: f.phone },
            messages: [
              {
                id: randomUUID(),
                from: f.contact.waId,
                timestamp: String(timestamp),
                type: 'reaction',
                reaction: { message_id: f.original.whatsappMessageId, emoji },
                ...extra,
              },
            ],
          },
        },
      ],
    },
  ],
});

describe('native WhatsApp reactions', () => {
  it('accepts one Unicode emoji sequence or removal, rejects text and multiple emoji', () => {
    for (const value of [
      '',
      thumb,
      heart,
      '\u{1F469}\u200D\u{1F4BB}',
      '\u{1F1EE}\u{1F1F3}',
      '1\uFE0F\u20E3',
    ])
      expect(validReaction(value)).toBe(true);
    for (const value of ['hello', `${thumb}${heart}`, ` ${thumb}`, '\u200D', '\u0000', null])
      expect(validReaction(value)).toBe(false);
  });
  it('queues recipient-bound reactions once and merges only after provider acknowledgement', async () => {
    const f = await fixture(),
      key = randomUUID(),
      first = await send(f, thumb, f.original.id, key);
    expect(first.status).toBe(202);
    expect((await send(f, thumb, f.original.id, key)).body).toEqual(first.body);
    expect((await send(f, heart, f.original.id, key)).status).toBe(409);
    expect((await target(f)).data).toMatchObject({ reactions: { contact: heart } });
    expect((await target(f)).data).not.toHaveProperty('reactions.self');
    const job = (await jobs(f))[0];
    expect((job.payload as any).payload).toMatchObject({
      to: f.contact.waId,
      type: 'reaction',
      reaction: { message_id: f.original.whatsappMessageId, emoji: thumb },
    });
    const fetch = remote();
    await processJob(job);
    await processJob(job);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await target(f)).data).toMatchObject({
      incoming: { text: 'Original' },
      reactions: { self: thumb, contact: heart },
      nativeReactionState: { self: { messageId: first.body.id } },
    });
  });
  it('serializes pending or uncertain changes and removes only the self side on acknowledgement', async () => {
    const f = await fixture();
    expect((await send(f)).status).toBe(202);
    expect((await send(f, '')).status).toBe(409);
    const job = (await jobs(f))[0];
    await db.whatsappMessageLogs.update({
      where: { id: (job.payload as any).messageId },
      data: { status: 'uncertain' },
    });
    expect((await send(f, '')).status).toBe(409);
    remote();
    await processJob(job);
    expect((await send(f, '')).status).toBe(202);
    await processJob((await jobs(f))[1]);
    expect((await target(f)).data).toMatchObject({ reactions: { contact: heart } });
    expect((await target(f)).data).not.toHaveProperty('reactions.self');
  });
  it('rejects malformed requests, foreign targets and inaccessible recipients without jobs', async () => {
    const f = await fixture(),
      other = await fixture();
    for (const value of ['hello', `${thumb}${heart}`, ' ', '\u0000'])
      expect((await send(f, value)).status).toBe(400);
    expect((await send(f, thumb, other.original.id)).status).toBe(409);
    expect((await send({ ...f, contact: other.contact })).status).toBe(404);
    expect((await send({ ...f, phone: `${f.phone}9` })).status).toBe(409);
    expect(await jobs(f)).toHaveLength(0);
  });
  for (const change of [
    'expired',
    'missing-id',
    'reaction',
    'primitive-data',
    'wrong-number',
    'failed',
  ])
    it(`rejects ${change} targets`, async () => {
      const f = await fixture();
      const changes: any = {
        expired: { messagedAt: new Date(Date.now() - 31 * 86400000) },
        'missing-id': { whatsappMessageId: null },
        reaction: { type: 'reaction' },
        'primitive-data': { data: 'legacy' },
        'wrong-number': { wabPhoneNumberId: `${f.phone}9` },
        failed: { status: 'failed' },
      };
      // Keep a genuine recent incoming message so rejection tests the target, not the service window.
      await db.whatsappMessageLogs.create({
        data: {
          vendorId: f.vendorId,
          contactId: f.contact.id,
          contactWaId: f.contact.waId,
          wabPhoneNumberId: f.phone,
          type: 'text',
          isIncomingMessage: true,
          messagedAt: new Date(),
        },
      });
      await db.whatsappMessageLogs.update({ where: { id: f.original.id }, data: changes[change] });
      expect((await send(f)).status).toBe(409);
      expect(await jobs(f)).toHaveLength(0);
    });
  it('cancels a queued reaction when its provider target changes before dispatch', async () => {
    const f = await fixture(),
      queued = await send(f);
    await db.whatsappMessageLogs.update({
      where: { id: f.original.id },
      data: { whatsappMessageId: 'wamid.changed' },
    });
    const fetch = remote();
    await processJob((await jobs(f))[0]);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: queued.body.id } })).status,
    ).toBe('cancelled');
  });
  it('requires a genuine incoming service window even if an imported reaction is recent', async () => {
    const f = await fixture();
    await db.whatsappMessageLogs.update({
      where: { id: f.original.id },
      data: { messagedAt: new Date(Date.now() - 25 * 3600000) },
    });
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contact.id,
        contactWaId: f.contact.waId,
        wabPhoneNumberId: f.phone,
        type: 'reaction',
        isIncomingMessage: true,
        messagedAt: new Date(),
      },
    });
    expect(await customerWindowOpen(f.vendorId, f.contact.id, f.phone, f.contact.waId!)).toBe(
      false,
    );
    expect((await send(f)).status).toBe(409);
  });
  it('deduplicates customer reactions without unread increments, reopening, new chat logs or bot sends', async () => {
    const f = await fixture();
    await db.contacts.update({
      where: { id: f.contact.id },
      data: { conversationStatus: 'resolved', unreadMessagesCount: 0 },
    });
    const incoming = event(f);
    await Promise.all([ingestMeta(incoming), ingestMeta(incoming)]);
    expect((await target(f)).data).toMatchObject({ reactions: { contact: thumb } });
    expect(await db.whatsappMessageLogs.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).toMatchObject({
      conversationStatus: 'resolved',
      unreadMessagesCount: 0,
    });
    expect(await jobs(f)).toHaveLength(0);
  });
  it('orders contact updates, removes the contact side and preserves concurrent self metadata', async () => {
    const f = await fixture(),
      now = Math.floor(Date.now() / 1000);
    await send(f);
    remote();
    await Promise.all([processJob((await jobs(f))[0]), ingestMeta(event(f, thumb, now))]);
    await ingestMeta(event(f, heart, now - 1));
    await ingestMeta(event(f, heart, now));
    expect((await target(f)).data).toMatchObject({ reactions: { self: thumb, contact: thumb } });
    await ingestMeta(event(f, '', now + 1));
    expect((await target(f)).data).toMatchObject({
      reactions: { self: thumb },
      incoming: { text: 'Original' },
    });
    expect((await target(f)).data).not.toHaveProperty('reactions.contact');
  });
  it('keeps unknown, wrong sender/number, malformed, future and ambiguous target events as receipts only', async () => {
    const f = await fixture(),
      before = (await target(f)).data,
      now = Math.floor(Date.now() / 1000);
    await ingestMeta(event(f, thumb, now, { from: '919000000111' }));
    await ingestMeta(
      event(f, thumb, now, { reaction: { message_id: 'wamid.unknown', emoji: thumb } }),
    );
    await ingestMeta(event(f, 'invalid'));
    await ingestMeta(event(f, thumb, now + 600));
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: `${f.phone}9`,
        secret: encrypt('other'),
      },
    });
    await ingestMeta(event({ ...f, phone: `${f.phone}9` }));
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect((await target(f)).data).toEqual(before);
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contact.id,
        contactWaId: f.contact.waId,
        wabPhoneNumberId: f.phone,
        whatsappMessageId: f.original.whatsappMessageId,
        type: 'text',
        isIncomingMessage: false,
        messagedAt: f.original.messagedAt,
      },
    });
    await ingestMeta(event(f));
    expect((await target(f)).data).toEqual(before);
    expect(await jobs(f)).toHaveLength(0);
  });
  it('does not overwrite a newer accepted reaction when an older acknowledgement is repeated', async () => {
    const f = await fixture();
    await send(f);
    const first = (await jobs(f))[0];
    remote();
    await processJob(first);
    await send(f, heart);
    const second = (await jobs(f))[1];
    await processJob(second);
    await db.$transaction((tx) =>
      acknowledgeReaction(
        tx,
        f.vendorId,
        (first.payload as any).nativeReaction,
        (first.payload as any).messageId,
        thumb,
      ),
    );
    expect((await target(f)).data).toMatchObject({ reactions: { self: heart } });
  });
  it('does not change the original reaction on a provider transport failure', async () => {
    const f = await fixture();
    await send(f);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection lost')));
    await expect(processJob((await jobs(f))[0])).rejects.toBeTruthy();
    expect((await target(f)).data).not.toHaveProperty('reactions.self');
    expect((await send(f, '')).status).toBe(409);
  });
  it('allows only one concurrent change for the same target', async () => {
    const f = await fixture(),
      results = await Promise.all([send(f, thumb), send(f, heart)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(await jobs(f)).toHaveLength(1);
  });
  it('does not accept a waiting human handoff when sending a reaction', async () => {
    const f = await fixture();
    await db.$transaction((tx) =>
      requestHandoff(tx, f.contact, { reason: 'human_requested', severity: 'high' }),
    );
    expect((await send(f)).status).toBe(202);
    remote();
    await processJob((await jobs(f))[0]);
    expect(
      await db.aiConversationHandoffs.findUniqueOrThrow({
        where: { openKey: `${f.vendorId}:${f.contact.id}` },
      }),
    ).toMatchObject({ status: 'waiting', acceptedByUsersId: null });
  });
  it('merges an early signed acceptance callback once before the HTTP acknowledgement', async () => {
    const f = await fixture();
    await send(f);
    const job = (await jobs(f))[0],
      providerId = `wamid.callback.${randomUUID()}`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await ingestMeta({
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: f.phone },
                    statuses: [
                      {
                        id: providerId,
                        recipient_id: f.contact.waId,
                        status: 'sent',
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        biz_opaque_callback_data: job.id,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
        return new Response(JSON.stringify({ messages: [{ id: providerId }] }));
      }),
    );
    await processJob(job);
    await processJob(job);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await target(f)).data).toMatchObject({ reactions: { self: thumb, contact: heart } });
  });
  for (const change of ['window', 'revoked', 'disconnected'])
    it(`prevents a queued reaction after ${change} changes`, async () => {
      const f = await fixture();
      await send(f);
      const job = (await jobs(f))[0];
      if (change === 'window')
        await db.whatsappMessageLogs.update({
          where: { id: f.original.id },
          data: { messagedAt: new Date(Date.now() - 25 * 3600000) },
        });
      if (change === 'revoked')
        await db.nativeMemberships.update({
          where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
          data: { active: false },
        });
      if (change === 'disconnected')
        await db.integrationCredentials.deleteMany({
          where: { vendorId: f.vendorId, provider: 'whatsapp' },
        });
      const fetch = remote();
      await expect(processJob(job)).rejects.toBeTruthy();
      expect(fetch).not.toHaveBeenCalled();
      expect((await target(f)).data).not.toHaveProperty('reactions.self');
    });
});
