import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
import { processJob } from '../src/jobs/dispatcher.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    phone = `7811${f.vendorId}`;
  await db.manualSubscriptions.create({ data: { vendorId: f.vendorId, status: 'active' } });
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-reply'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9198${f.vendorId}`,
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  const target = await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phone,
      whatsappMessageId: `wamid.${randomUUID()}`,
      type: 'text',
      message: 'Original',
      isIncomingMessage: true,
      status: 'received',
      messagedAt: new Date(Date.now() - 10000),
    },
  });
  return { ...f, phone, contact, target };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const send = (f: Fixture, key = randomUUID(), target = f.target.whatsappMessageId!) =>
  request(app)
    .post('/vendor-console/whatsapp/contact/chat/send')
    .set('Authorization', `Bearer ${f.token}`)
    .set('Idempotency-Key', key)
    .send({ contact_uid: f.contact.uid, message_body: 'Quoted reply', reply_to_wamid: target });
const job = (f: Fixture, key: string) =>
  db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `send:${f.vendorId}:${key}` } });
describe('guarded quoted WhatsApp replies', () => {
  it('maps the original reply field, persists the safe UID and sends context once', async () => {
    const f = await fixture(),
      key = randomUUID(),
      result = await send(f, key);
    expect(result.status).toBe(202);
    expect((await send(f, key)).body).toEqual(result.body);
    const queued = await job(f, key);
    expect((queued.payload as any).payload.context).toEqual({
      message_id: f.target.whatsappMessageId,
    });
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: result.body.data.id } }))
        .repliedToWhatsappMessageLogsUid,
    ).toBe(f.target.uid);
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid.reply.' + randomUUID() }] })),
    );
    vi.stubGlobal('fetch', fetch);
    await processJob(queued);
    await processJob(queued);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      context: { message_id: f.target.whatsappMessageId },
      text: { body: 'Quoted reply' },
    });
  });
  it('rejects foreign, missing and ambiguous provider IDs without creating delivery records', async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await send(f, randomUUID(), other.target.whatsappMessageId!)).status).toBe(409);
    expect((await send(f, randomUUID(), 'wamid.missing')).status).toBe(409);
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contact.id,
        contactWaId: f.contact.waId,
        wabPhoneNumberId: f.phone,
        whatsappMessageId: f.target.whatsappMessageId,
        isIncomingMessage: true,
        status: 'received',
        messagedAt: new Date(),
      },
    });
    expect((await send(f)).status).toBe(409);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rejects invalid target status, reaction type, recipient or phone ownership', async () => {
    for (const change of [
      { status: 'failed' },
      { status: 'cancelled' },
      { status: 'uncertain' },
      { type: 'reaction' },
      { contactWaId: '919900000000' },
      { wabPhoneNumberId: '9999999' },
    ]) {
      const f = await fixture();
      await db.whatsappMessageLogs.update({ where: { id: f.target.id }, data: change });
      expect((await send(f)).status).toBe(409);
      expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
    }
  });
  it('conflicts changed quote targets while preserving replay after a target change', async () => {
    const f = await fixture(),
      key = randomUUID(),
      result = await send(f, key);
    expect(result.status).toBe(202);
    expect((await send(f, key, 'wamid.other')).status).toBe(409);
    await db.whatsappMessageLogs.update({
      where: { id: f.target.id },
      data: { status: 'cancelled' },
    });
    expect((await send(f, key)).body).toEqual(result.body);
  });
  it('cancels queued quotes after provider identity changes before dispatch', async () => {
    const f = await fixture(),
      key = randomUUID();
    expect((await send(f, key)).status).toBe(202);
    await db.whatsappMessageLogs.update({
      where: { id: f.target.id },
      data: { whatsappMessageId: 'wamid.changed' },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(await job(f, key));
    expect(fetch).not.toHaveBeenCalled();
    const queued = await job(f, key);
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (queued.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
  });
  it('supports native media reply context and forbids quote context on reaction messages', async () => {
    const f = await fixture();
    const body = {
      contactId: f.contact.id,
      phoneNumberId: f.phone,
      kind: 'media',
      media: { type: 'image', url: 'https://cdn.whalexy.com/a.png' },
      replyToWamid: f.target.whatsappMessageId,
    };
    const key = randomUUID(),
      result = await request(app)
        .post(`/api/v1/vendors/${f.vendorId}/messages/send`)
        .set('Authorization', `Bearer ${f.token}`)
        .set('Idempotency-Key', key)
        .send(body);
    expect(result.status).toBe(202);
    expect((await job(f, key)).payload).toMatchObject({
      payload: {
        context: { message_id: f.target.whatsappMessageId },
        image: { link: body.media.url },
      },
    });
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${f.vendorId}/messages/send`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            contactId: f.contact.id,
            phoneNumberId: f.phone,
            kind: 'reaction',
            reaction: { messageId: f.target.id, emoji: '' },
            replyToWamid: f.target.whatsappMessageId,
          })
      ).status,
    ).toBe(400);
  });
});
