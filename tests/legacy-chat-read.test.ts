import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
import type { Contacts, WhatsappMessageLogs } from '@prisma/client';
const app = createApp(),
  base = '/vendor-console/whatsapp/contact';
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const actor = await businessFixture(permissions),
    phone = `7788${actor.vendorId}`,
    otherPhone = `7799${actor.vendorId}`;
  await db.integrationCredentials.create({
    data: { vendorId: actor.vendorId, provider: 'whatsapp', externalId: phone, secret: 'unused' },
  });
  const contacts: Contacts[] = [],
    messages: WhatsappMessageLogs[] = [];
  for (const [index, name] of ['Alpha', 'Beta', 'Empty'].entries())
    contacts.push(
      await db.contacts.create({
        data: {
          vendorId: actor.vendorId,
          firstName: name,
          waId: `9197${actor.vendorId}${index}`,
          email: 'hidden-contact@example.com',
          wabPhoneNumberId: phone,
          platform: index === 0 ? null : 'whatsapp',
          assignedUserId: index === 0 ? actor.userId : null,
          data: { token: 'private-contact-data' },
        },
      }),
    );
  const at = Date.now() - 60000;
  for (let i = 0; i < 4; i++)
    messages.push(
      await db.whatsappMessageLogs.create({
        data: {
          vendorId: actor.vendorId,
          contactId: contacts[0].id,
          contactWaId: contacts[0].waId,
          wabPhoneNumberId: phone,
          message: `Message ${i}`,
          type: 'text',
          status: i === 0 ? 'read' : 'received',
          isIncomingMessage: true,
          messagedAt: new Date(at + i * 1000),
          data: { token: 'private-webhook-token', nativeReactionState: { private: true } },
        },
      }),
    );
  await db.whatsappMessageLogs.create({
    data: {
      vendorId: actor.vendorId,
      contactId: contacts[1].id,
      wabPhoneNumberId: phone,
      message: 'Beta latest',
      isIncomingMessage: false,
      status: 'sent',
      messagedAt: new Date(at + 10000),
    },
  });
  const other = await db.whatsappMessageLogs.create({
    data: {
      vendorId: actor.vendorId,
      contactId: contacts[0].id,
      wabPhoneNumberId: otherPhone,
      message: 'Other sender secret',
      isIncomingMessage: true,
      status: 'received',
      messagedAt: new Date(at + 20000),
    },
  });
  const read = (tail: string, query: Record<string, unknown> = {}) =>
    request(app).get(`${base}/${tail}`).set('Authorization', `Bearer ${actor.token}`).query(query);
  return { ...actor, phone, otherPhone, contacts, messages, other, read };
}
describe('original web chat reads', () => {
  it('pages messages in stable chronological display order without private metadata or read effects', async () => {
    const f = await fixture(),
      first = await f.read(`chat-data/${f.contacts[0].uid}`, { limit: 2 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      messagePaginatePage: 2,
      way: 'append',
      phone_number_id: f.phone,
    });
    expect(Object.keys(first.body.whatsappMessageLogs)).toEqual([
      f.messages[2].uid,
      f.messages[3].uid,
    ]);
    const second = await f.read(`chat-data/${f.contacts[0].uid}/prepend`, { limit: 2, page: 2 });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ messagePaginatePage: 0, way: 'prepend' });
    expect(Object.keys(second.body.whatsappMessageLogs)).toEqual([
      f.messages[0].uid,
      f.messages[1].uid,
    ]);
    expect(
      (await f.read(`chat-data/${f.contacts[0].uid}`, { page: 10 })).body.whatsappMessageLogs,
    ).toEqual({});
    for (const value of ['private-webhook-token', 'nativeReactionState', 'Other sender secret'])
      expect(JSON.stringify(first.body)).not.toContain(value);
    expect(
      await db.whatsappMessageLogs.count({ where: { vendorId: f.vendorId, status: 'received' } }),
    ).toBe(4);
  });
  it('scopes history to owned numbers and validates imported reply links', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: f.otherPhone,
        secret: 'unused',
      },
    });
    await db.whatsappMessageLogs.update({
      where: { id: f.messages[3].id },
      data: { repliedToWhatsappMessageLogsUid: foreign.messages[0].uid },
    });
    await db.whatsappMessageLogs.update({
      where: { id: f.messages[2].id },
      data: { repliedToWhatsappMessageLogsUid: f.messages[0].uid },
    });
    const result = await f.read(`chat-data/${f.contacts[0].uid}`);
    expect(
      result.body.whatsappMessageLogs[f.messages[3].uid].replied_to_whatsapp_message_logs__uid,
    ).toBeNull();
    expect(
      result.body.whatsappMessageLogs[f.messages[2].uid].replied_to_whatsapp_message_logs__uid,
    ).toBe(f.messages[0].uid);
    expect(
      Object.keys(
        (await f.read(`chat-data/${f.contacts[0].uid}`, { from_phone_number_id: f.otherPhone }))
          .body.whatsappMessageLogs,
      ),
    ).toEqual([f.other.uid]);
    expect(
      (await f.read(`chat-data/${f.contacts[0].uid}`, { from_phone_number_id: foreign.phone }))
        .status,
    ).toBe(400);
  });
  it('orders inbox by latest scoped message, paginates and appends a selected contact once', async () => {
    const f = await fixture(),
      result = await f.read('contacts-data', { limit: 1 });
    expect(result.status).toBe(200);
    expect(Object.keys(result.body.contacts)).toEqual([f.contacts[1].uid]);
    expect(result.body.contactsPaginatePage).toBe(2);
    const selected = await f.read(`contacts-data/${f.contacts[0].uid}`, { limit: 1 });
    expect(Object.keys(selected.body.contacts)).toEqual([f.contacts[1].uid, f.contacts[0].uid]);
    expect(selected.body.contacts[f.contacts[0].uid]).toMatchObject({
      first_name: 'Alpha',
      wa_id: f.contacts[0].waId,
      unread_messages_count: 3,
    });
    expect(
      Object.keys((await f.read(`contacts-data/${f.contacts[1].uid}`, { limit: 1 })).body.contacts),
    ).toHaveLength(1);
    expect(
      Object.keys((await f.read('contacts-data', { page: 2, limit: 1 })).body.contacts),
    ).toEqual([f.contacts[0].uid]);
    expect((await f.read('contacts-data', { page: 3, limit: 1 })).body.contacts).toEqual({});
    expect(JSON.stringify(selected.body)).not.toContain('private-contact-data');
  });
  it('filters assignments, unread, literal search, groups, labels and requested contact', async () => {
    const f = await fixture(),
      group = await db.contactGroups.create({
        data: { vendorId: f.vendorId, title: 'Inbox group' },
      }),
      label = await db.labels.create({ data: { vendorId: f.vendorId, title: 'Inbox label' } });
    await db.groupContacts.create({ data: { groupId: group.id, contactId: f.contacts[0].id } });
    await db.contactLabels.create({ data: { labelsId: label.id, contactId: f.contacts[0].id } });
    for (const query of [
      { assigned: 'to-me' },
      { unread_only: 'true' },
      { search: 'aLpHa' },
      { group_id: group.id },
      { label_id: label.id },
      { request_contact: f.contacts[0].uid },
    ])
      expect(Object.keys((await f.read('contacts-data', query)).body.contacts)).toEqual([
        f.contacts[0].uid,
      ]);
    expect(
      Object.keys((await f.read('contacts-data', { assigned: 'unassigned' })).body.contacts),
    ).toEqual([f.contacts[1].uid]);
    for (const search of ['%', "' OR 1=1 --"])
      expect((await f.read('contacts-data', { search })).body.contacts).toEqual({});
    expect((await f.read(`contacts-data/${f.contacts[0].uid}`, { search: 'Beta' })).status).toBe(
      404,
    );
  });
  it('enforces assigned visibility and excludes hidden identifiers from search', async () => {
    const f = await fixture(['vendor.contacts.view']),
      result = await f.read('contacts-data');
    expect(result.status).toBe(200);
    expect(Object.keys(result.body.contacts)).toEqual([f.contacts[0].uid]);
    expect(result.body.contacts[f.contacts[0].uid]).toMatchObject({
      wa_id: '***' + f.contacts[0].waId!.slice(-4),
      email: null,
    });
    for (const search of [f.contacts[0].waId!, 'hidden-contact@example.com'])
      expect((await f.read('contacts-data', { search })).body.contacts).toEqual({});
    expect((await f.read('contacts-data', { assigned: 'unassigned' })).body.contacts).toEqual({});
    expect((await f.read(`chat-data/${f.contacts[1].uid}`)).status).toBe(404);
    expect((await f.read(`contacts-data/${f.contacts[1].uid}`)).status).toBe(404);
  });
  it('rejects foreign identifiers, invalid bounds, unsupported filters and missing authorization', async () => {
    const f = await fixture(),
      foreign = await fixture(),
      denied = await fixture(['vendor.chats.reply']);
    for (const uid of [foreign.contacts[0].uid, randomUUID()]) {
      expect((await f.read(`chat-data/${uid}`)).status).toBe(404);
      expect((await f.read(`contacts-data/${uid}`)).status).toBe(404);
    }
    const group = await db.contactGroups.create({
        data: { vendorId: foreign.vendorId, title: 'Foreign' },
      }),
      label = await db.labels.create({ data: { vendorId: foreign.vendorId, title: 'Foreign' } });
    expect((await f.read('contacts-data', { group_id: group.id })).status).toBe(404);
    expect((await f.read('contacts-data', { label_id: label.id })).status).toBe(404);
    for (const q of [
      { limit: 101 },
      { page: 10001 },
      { intent: 'purchase' },
      { assigned: 'someone-else' },
      { label_id: 0 },
      { request_contact: 'bad' },
    ])
      expect((await f.read('contacts-data', q)).status).toBe(400);
    expect((await f.read('chat-data/bad')).status).toBe(400);
    expect((await f.read(`chat-data/${f.contacts[0].uid}/unsafe`)).status).toBe(400);
    expect((await denied.read('contacts-data')).status).toBe(403);
    expect((await request(app).get(`${base}/contacts-data`)).status).toBe(401);
  });
  it('rejects ambiguous numbers, social history and selected contacts without scoped messages', async () => {
    const f = await fixture();
    expect((await f.read(`contacts-data/${f.contacts[2].uid}`)).status).toBe(404);
    expect((await f.read(`chat-data/${f.contacts[2].uid}`)).body.whatsappMessageLogs).toEqual({});
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: f.otherPhone,
        secret: 'unused',
      },
    });
    expect((await f.read('contacts-data')).status).toBe(409);
    expect((await f.read('contacts-data', { from_phone_number_id: f.phone })).status).toBe(200);
    await db.contacts.update({ where: { id: f.contacts[0].id }, data: { platform: 'instagram' } });
    expect((await f.read(`chat-data/${f.contacts[0].uid}`)).status).toBe(409);
    expect(
      Object.keys((await f.read('contacts-data', { from_phone_number_id: f.phone })).body.contacts),
    ).toEqual([f.contacts[1].uid]);
    await db.integrationCredentials.deleteMany({ where: { vendorId: f.vendorId } });
    expect((await f.read('contacts-data')).status).toBe(409);
  });
  it('prepares supported media types with an image default and reply permission', async () => {
    const f = await fixture(['vendor.chats.reply']);
    expect((await f.read('chat/prepare-send-media')).body).toEqual({
      uploadTitle: 'Select Image',
      mediaType: 'image',
    });
    for (const [type, title] of Object.entries({
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
      document: 'Document',
    }))
      expect((await f.read(`chat/prepare-send-media/${type}`)).body).toEqual({
        uploadTitle: `Select ${title}`,
        mediaType: type,
      });
    expect((await f.read('chat/prepare-send-media/executable')).status).toBe(400);
    expect((await f.read('chat/prepare-send-media/image', { unsupported: true })).status).toBe(400);
    const readOnly = await fixture(['vendor.contacts.view']);
    expect((await readOnly.read('chat/prepare-send-media')).status).toBe(403);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
});

const unread = (f: Awaited<ReturnType<typeof fixture>>, query: Record<string, unknown> = {}) =>
  request(app)
    .get('/vendor-console/whatsapp/chat/unread-count')
    .set('Authorization', `Bearer ${f.token}`)
    .query(query);
describe('original unread count adapter', () => {
  it('counts scoped incoming received messages with ownership and assignment protection', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contacts[1].id,
        wabPhoneNumberId: f.phone,
        isIncomingMessage: true,
        status: 'received',
        messagedAt: new Date(),
      },
    });
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: foreign.vendorId,
        contactId: f.contacts[0].id,
        wabPhoneNumberId: f.phone,
        isIncomingMessage: true,
        status: 'received',
        messagedAt: new Date(),
      },
    });
    const response = await unread(f);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      unreadMessagesCount: 4,
      myAssignedUnreadMessagesCount: 3,
      myUnassignedUnreadMessagesCount: 1,
      phone_number_id: f.phone,
    });
    const restricted = await fixture(['vendor.contacts.view']);
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: restricted.vendorId,
        contactId: restricted.contacts[1].id,
        wabPhoneNumberId: restricted.phone,
        isIncomingMessage: true,
        status: 'received',
        messagedAt: new Date(),
      },
    });
    expect((await unread(restricted)).body).toMatchObject({
      unreadMessagesCount: 3,
      myAssignedUnreadMessagesCount: 3,
      myUnassignedUnreadMessagesCount: 0,
    });
  });
  it('requires a connected unambiguous sender, valid fields and read authorization', async () => {
    const f = await fixture(),
      denied = await fixture(['vendor.chats.reply']);
    expect((await unread(denied)).status).toBe(403);
    expect((await unread(f, { from_phone_number_id: '99999999' })).status).toBe(400);
    expect((await unread(f, { assigned: 'all' })).status).toBe(400);
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: f.otherPhone,
        secret: 'unused',
      },
    });
    expect((await unread(f)).status).toBe(409);
    expect((await unread(f, { from_phone_number_id: f.otherPhone })).body.unreadMessagesCount).toBe(
      1,
    );
    expect((await request(app).get('/vendor-console/whatsapp/chat/unread-count')).status).toBe(401);
  });
});
