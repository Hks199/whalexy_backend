import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { createApp } from '../src/app.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>, contactId: number, phone: string;
const send = (key: string) =>
  request(app)
    .post(`/api/v1/vendors/${owner.vendorId}/messages/send`)
    .set('Authorization', `Bearer ${owner.token}`)
    .set('Idempotency-Key', key)
    .send({ contactId, phoneNumberId: phone, kind: 'text', text: 'Message' });
beforeAll(async () => {
  owner = await businessFixture();
  phone = `5566${owner.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: owner.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-window-credential'),
    },
  });
  contactId = (
    await db.contacts.create({
      data: {
        vendorId: owner.vendorId,
        waId: '919733333333',
        messagedAt: new Date(),
        platform: 'whatsapp',
      },
    })
  ).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
describe('recipient-specific customer service windows', () => {
  it('does not let recent contact/outgoing activity open a window', async () => {
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: owner.vendorId,
        contactId,
        contactWaId: '919733333333',
        wabPhoneNumberId: phone,
        isIncomingMessage: false,
        messagedAt: new Date(),
        status: 'sent',
      },
    });
    expect((await send(randomUUID())).status).toBe(409);
  });
  it('does not reuse another business number or recipient window', async () => {
    await db.whatsappMessageLogs.createMany({
      data: [
        {
          vendorId: owner.vendorId,
          contactId,
          contactWaId: '919733333333',
          wabPhoneNumberId: 'wrong-business-number',
          isIncomingMessage: true,
          messagedAt: new Date(),
        },
        {
          vendorId: owner.vendorId,
          contactId,
          contactWaId: 'wrong-recipient',
          wabPhoneNumberId: phone,
          isIncomingMessage: true,
          messagedAt: new Date(),
        },
      ],
    });
    expect((await send(randomUUID())).status).toBe(409);
  });
  it('rechecks expiry at dispatch and preserves idempotent responses after expiry', async () => {
    const incoming = await db.whatsappMessageLogs.create({
      data: {
        vendorId: owner.vendorId,
        contactId,
        contactWaId: '919733333333',
        wabPhoneNumberId: phone,
        isIncomingMessage: true,
        messagedAt: new Date(),
      },
    });
    const key = randomUUID();
    expect((await send(key)).status).toBe(202);
    await db.whatsappMessageLogs.update({
      where: { id: incoming.id },
      data: { messagedAt: new Date(0) },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const job = await db.outboxJobs.findUniqueOrThrow({
      where: { dedupeKey: `send:${owner.vendorId}:${key}` },
    });
    await expect(processJob(job)).rejects.toMatchObject({ code: 'TEMPLATE_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
    expect((await send(key)).status).toBe(202);
    expect(
      await db.outboxJobs.count({ where: { dedupeKey: `send:${owner.vendorId}:${key}` } }),
    ).toBe(1);
    expect((await send(randomUUID())).status).toBe(409);
  });
  it.each([
    { waId: '919744444444' },
    { platform: 'instagram' },
    { status: 5 },
    { wabPhoneNumberId: 'different-business-number' },
  ])('cancels a queued template after recipient changes: %j', async (change) => {
    const template = await db.whatsappTemplates.create({
      data: {
        vendorId: owner.vendorId,
        templateName: `recipient_${randomUUID().replaceAll('-', '')}`,
        languageCode: 'en',
        category: 'UTILITY',
        status: 'APPROVED',
      },
    });
    const key = randomUUID();
    const response = await request(app)
      .post(`/api/v1/vendors/${owner.vendorId}/messages/send`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', key)
      .send({ contactId, phoneNumberId: phone, kind: 'template', templateId: template.id });
    expect(response.status).toBe(202);
    const queued = await db.outboxJobs.findUniqueOrThrow({
      where: { dedupeKey: `send:${owner.vendorId}:${key}` },
    });
    try {
      await db.contacts.update({ where: { id: contactId }, data: change });
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await processJob(queued);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: response.body.id } }))
          .status,
      ).toBe('cancelled');
    } finally {
      await db.contacts.update({
        where: { id: contactId },
        data: { waId: '919733333333', platform: 'whatsapp', status: 1, wabPhoneNumberId: null },
      });
    }
  });
});
