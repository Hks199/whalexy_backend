import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const actor = await businessFixture(permissions),
    phone = `7766${actor.vendorId}`;
  await db.manualSubscriptions.create({ data: { vendorId: actor.vendorId, status: 'active' } });
  await db.integrationCredentials.create({
    data: { vendorId: actor.vendorId, provider: 'whatsapp', externalId: phone, secret: 'unused' },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: actor.vendorId,
      waId: `9196${String(actor.vendorId).padStart(7, '0')}`,
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  const original = await db.whatsappMessageLogs.create({
    data: {
      vendorId: actor.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phone,
      whatsappMessageId: `wamid.${randomUUID()}`,
      type: 'text',
      isIncomingMessage: true,
      status: 'received',
      messagedAt: new Date(Date.now() - 10000),
    },
  });
  return { ...actor, phone, contact, original };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function send(f: Fixture, route: string, body: Record<string, unknown>, key = randomUUID()) {
  return request(app)
    .post(`/vendor-console/whatsapp/contact/chat/${route}`)
    .set('Authorization', `Bearer ${f.token}`)
    .set('Idempotency-Key', key)
    .send(body);
}
async function job(f: Fixture, key: string) {
  return db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `send:${f.vendorId}:${key}` } });
}
describe('original web chat send adapters', () => {
  it('maps text, echoes correlation, queues once and detects changed idempotent requests', async () => {
    const f = await fixture(),
      key = randomUUID(),
      body = { contact_uid: f.contact.uid, message_body: 'Hello', client_message_uid: 'browser-1' };
    const result = await send(f, 'send', body, key);
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      status: 'queued',
      client_message_uid: 'browser-1',
      data: { status: 'queued' },
    });
    expect((await send(f, 'send', body, key)).body).toEqual(result.body);
    expect((await send(f, 'send', { ...body, message_body: 'Changed' }, key)).status).toBe(409);
    expect((await job(f, key)).payload).toMatchObject({
      sentByUserId: f.userId,
      payload: { type: 'text', text: { body: 'Hello' } },
    });
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('maps valid static coordinates without fabricating live location effects', async () => {
    const f = await fixture(),
      key = randomUUID();
    expect(
      (
        await send(
          f,
          'send-location',
          {
            contact_uid: f.contact.uid,
            location_type: 'static',
            location_latitude: '26.9124',
            location_longitude: '75.7873',
            location_name: 'Office',
            location_address: 'Jaipur',
          },
          key,
        )
      ).status,
    ).toBe(202);
    expect((await job(f, key)).payload).toMatchObject({
      payload: {
        type: 'location',
        location: { latitude: 26.9124, longitude: 75.7873, name: 'Office', address: 'Jaipur' },
      },
    });
    expect(
      (
        await send(f, 'send-location', {
          contact_uid: f.contact.uid,
          location_type: 'live',
          live_duration: 60,
        })
      ).status,
    ).toBe(409);
    for (const extra of [{}, { location_latitude: 91, location_longitude: 0 }])
      expect(
        (
          await send(f, 'send-location', {
            contact_uid: f.contact.uid,
            location_type: 'static',
            ...extra,
          })
        ).status,
      ).toBe(400);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('maps message UUID reactions and replay while deferring local acknowledgement', async () => {
    const f = await fixture(),
      key = randomUUID(),
      route = `message/${f.original.uid}/reaction`;
    expect((await send(f, route, { emoji: '\u{1F44D}' }, key)).status).toBe(202);
    expect((await send(f, route, { emoji: '\u{1F44D}' }, key)).status).toBe(202);
    expect((await job(f, key)).payload).toMatchObject({
      payload: {
        type: 'reaction',
        reaction: { message_id: f.original.whatsappMessageId, emoji: '\u{1F44D}' },
      },
    });
    expect(
      (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: f.original.id } })).data,
    ).toBeNull();
    expect((await send(f, route, { emoji: '' })).status).toBe(409);
  });
  it('accepts reaction removal with omitted or null emoji and rejects non-emoji text', async () => {
    for (const body of [{}, { emoji: null }]) {
      const f = await fixture(),
        key = randomUUID();
      expect((await send(f, `message/${f.original.uid}/reaction`, body, key)).status).toBe(202);
      expect((await job(f, key)).payload).toMatchObject({ payload: { reaction: { emoji: '' } } });
    }
    const f = await fixture();
    expect((await send(f, `message/${f.original.uid}/reaction`, { emoji: 'abc' })).status).toBe(
      400,
    );
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rejects foreign contact/message UUIDs, assigned-only visibility and missing permission', async () => {
    const f = await fixture(),
      other = await fixture(),
      restricted = await fixture(['vendor.chats.reply']),
      denied = await fixture(['vendor.contacts.view']);
    expect(
      (await send(f, 'send', { contact_uid: other.contact.uid, message_body: 'No' })).status,
    ).toBe(404);
    expect((await send(f, `message/${other.original.uid}/reaction`, { emoji: '' })).status).toBe(
      404,
    );
    expect(
      (await send(restricted, 'send', { contact_uid: restricted.contact.uid, message_body: 'No' }))
        .status,
    ).toBe(404);
    expect((await send(restricted, `message/${restricted.original.uid}/reaction`, {})).status).toBe(
      404,
    );
    expect(
      (await send(denied, 'send', { contact_uid: denied.contact.uid, message_body: 'No' })).status,
    ).toBe(403);
    expect(
      (await request(app).post('/vendor-console/whatsapp/contact/chat/send').send({})).status,
    ).toBe(401);
  });
  it('enforces active plan, customer window, sender scope and idempotency header', async () => {
    const f = await fixture(),
      body = { contact_uid: f.contact.uid, message_body: 'Hi' };
    expect(
      (
        await request(app)
          .post('/vendor-console/whatsapp/contact/chat/send')
          .set('Authorization', `Bearer ${f.token}`)
          .send(body)
      ).status,
    ).toBe(400);
    expect((await send(f, 'send', { ...body, from_phone_number_id: '999999999' })).status).toBe(
      409,
    );
    await db.whatsappMessageLogs.update({
      where: { id: f.original.id },
      data: { messagedAt: new Date(Date.now() - 25 * 3600000) },
    });
    expect((await send(f, 'send', body)).status).toBe(409);
    await db.manualSubscriptions.updateMany({
      where: { vendorId: f.vendorId },
      data: { status: 'inactive' },
    });
    expect((await send(f, 'send', body)).status).toBe(403);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rejects invalid UUIDs, unknown fields and unreconciled reaction targets', async () => {
    const f = await fixture(),
      body = { contact_uid: f.contact.uid, message_body: 'Hi' };
    expect((await send(f, 'send', { ...body, contact_uid: 'bad' })).status).toBe(400);
    expect((await send(f, 'send', { ...body, unknown: true })).status).toBe(400);
    await db.whatsappMessageLogs.update({
      where: { id: f.original.id },
      data: { wabPhoneNumberId: null },
    });
    expect((await send(f, `message/${f.original.uid}/reaction`, {})).status).toBe(409);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
});
