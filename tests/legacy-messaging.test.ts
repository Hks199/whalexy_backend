import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>, foreign: typeof owner;
let base: string, businessNumber: string, contact: { id: number; uid: string; waId: string | null };
const send = (route: string, body: Record<string, unknown>, key = randomUUID()) =>
  request(app)
    .post(`${base}/${route}`)
    .set('Authorization', `Bearer ${owner.token}`)
    .set('Idempotency-Key', key)
    .send({ phone_number: contact.waId, ...body });
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  base = `/api/${(await db.vendors.findUniqueOrThrow({ where: { id: owner.vendorId } })).uid}/contact`;
  businessNumber = '334455' + owner.vendorId;
  await db.manualSubscriptions.create({ data: { vendorId: owner.vendorId, status: 'active' } });
  await db.integrationCredentials.create({
    data: {
      vendorId: owner.vendorId,
      provider: 'whatsapp',
      externalId: businessNumber,
      secret: 'unused',
    },
  });
  contact = await db.contacts.create({
    data: {
      vendorId: owner.vendorId,
      waId: '919755555555',
      platform: 'whatsapp',
      wabPhoneNumberId: businessNumber,
    },
  });
  await db.whatsappMessageLogs.create({
    data: {
      vendorId: owner.vendorId,
      contactId: contact.id,
      contactWaId: contact.waId!,
      wabPhoneNumberId: businessNumber,
      isIncomingMessage: true,
      messagedAt: new Date(),
    },
  });
});
afterAll(async () => db.$disconnect());
describe('original messaging API adapters', () => {
  it('queues text once, maps original fields and does not invent provider acknowledgements', async () => {
    const key = randomUUID(),
      body = { message_body: 'Original API message' };
    const result = await send('send-message', body, key);
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      result: 'success',
      data: {
        contact_uid: contact.uid,
        phone_number: contact.waId,
        status: 'queued',
        wamid: null,
        log_uid: null,
      },
    });
    expect((await send('send-message', body, key)).body).toEqual(result.body);
    expect((await send('send-message', { message_body: 'Changed' }, key)).status).toBe(409);
    const jobs = await db.outboxJobs.findMany({
      where: { vendorId: owner.vendorId, dedupeKey: `send:${owner.vendorId}:${key}` },
    });
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as any).payload.text.body).toBe(body.message_body);
  });
  it('maps media caption and document filename and rejects unsafe or incompatible input', async () => {
    const key = randomUUID();
    expect(
      (
        await send(
          'send-media-message',
          {
            media_type: 'document',
            media_url: 'https://cdn.whalexy.com/invoice.pdf',
            message_body: 'Invoice',
            file_name: 'invoice.pdf',
          },
          key,
        )
      ).status,
    ).toBe(202);
    const job = await db.outboxJobs.findUniqueOrThrow({
      where: { dedupeKey: `send:${owner.vendorId}:${key}` },
    });
    expect((job.payload as any).payload.document).toEqual({
      link: 'https://cdn.whalexy.com/invoice.pdf',
      caption: 'Invoice',
      filename: 'invoice.pdf',
    });
    for (const body of [
      { media_type: 'image', media_url: 'http://127.0.0.1/a' },
      {
        media_type: 'audio',
        media_url: 'https://cdn.whalexy.com/audio.mp3',
        message_body: 'Not allowed',
      },
      { media_type: 'image', media_url: 'https://cdn.whalexy.com/a.png', file_name: 'a.png' },
    ])
      expect((await send('send-media-message', body)).status).toBe(400);
  });
  it('resolves approved templates by name and language and orders legacy text fields', async () => {
    const name = 'legacy_' + randomUUID().replaceAll('-', '');
    await db.whatsappTemplates.create({
      data: {
        vendorId: owner.vendorId,
        templateName: name,
        languageCode: 'en',
        status: 'APPROVED',
        category: 'UTILITY',
        data: {
          template: {
            components: [
              { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
              { type: 'BODY', text: '{{1}} / {{2}}' },
            ],
          },
        },
      },
    });
    const key = randomUUID();
    const body = {
      template_name: name,
      template_language: 'en',
      field_2: 'Second',
      field_1: 'First',
      header_field_1: 'Customer',
    };
    expect((await send('send-template-message', body, key)).status).toBe(202);
    const job = await db.outboxJobs.findUniqueOrThrow({
      where: { dedupeKey: `send:${owner.vendorId}:${key}` },
    });
    expect((job.payload as any).payload.template.components).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Customer' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      },
    ]);
    expect(
      (await send('send-template-message', { template_name: name, template_language: 'en' }))
        .status,
    ).toBe(400);
    expect((await send('send-template-message', { ...body, field_3: 'Unused' })).status).toBe(400);
    expect((await send('send-template-message', { ...body, template_language: 'fr' })).status).toBe(
      400,
    );
    const template = await db.whatsappTemplates.findFirstOrThrow({
      where: { vendorId: owner.vendorId, templateName: name },
    });
    await db.whatsappTemplates.update({
      where: { id: template.id },
      data: { data: { components: [{ type: 'HEADER', format: 'IMAGE' }] } },
    });
    expect((await send('send-template-message', body)).status).toBe(409);
  });
  it('preserves scope, service window, authentication, subscription and idempotency gates', async () => {
    expect(
      (
        await request(app)
          .post(`${base}/send-message`)
          .send({ phone_number: contact.waId, message_body: 'Unauthenticated' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${base}/send-message`)
          .set('Authorization', `Bearer ${foreign.token}`)
          .send({ phone_number: contact.waId, message_body: 'Foreign' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base}/send-message`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ phone_number: contact.waId, message_body: 'No key' })
      ).status,
    ).toBe(400);
    expect(
      (await send('send-message', { message_body: 'Missing', phone_number: '919766666666' }))
        .status,
    ).toBe(404);
    await db.whatsappMessageLogs.updateMany({
      where: { vendorId: owner.vendorId, contactId: contact.id },
      data: { messagedAt: new Date(0) },
    });
    expect((await send('send-message', { message_body: 'Outside window' })).body.error.code).toBe(
      'TEMPLATE_REQUIRED',
    );
    await db.manualSubscriptions.updateMany({
      where: { vendorId: owner.vendorId },
      data: { status: 'expired' },
    });
    expect((await send('send-message', { message_body: 'Expired plan' })).status).toBe(403);
  });
});
