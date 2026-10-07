import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { publicMediaUrl } from '../src/modules/messaging/services/media-message.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
async function fixture() {
  const f = await businessFixture(),
    phone = `7788${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('media-test'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9197${String(f.vendorId).padStart(7, '0')}`,
      firstName: 'Customer',
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  return {
    ...f,
    phone,
    contact,
    auth: `Bearer ${f.token}`,
    prefix: `/api/v1/vendors/${f.vendorId}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const incoming = (f: Fixture, text = 'hello') => ({
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
                type: 'text',
                text: { body: text },
                timestamp: String(Math.floor(Date.now() / 1000)),
              },
            ],
          },
        },
      ],
    },
  ],
});
const media = (type = 'image') => ({
  type,
  url: `https://cdn.example.com/file.${type}`,
  ...(type !== 'audio' ? { caption: 'Hello' } : {}),
  ...(type === 'document' ? { filename: 'Report.pdf' } : {}),
});
const send = (f: Fixture, value = media(), key = randomUUID()) =>
  request(app)
    .post(`${f.prefix}/messages/send`)
    .set('Authorization', f.auth)
    .set('Idempotency-Key', key)
    .send({ contactId: f.contact.id, phoneNumberId: f.phone, kind: 'media', media: value });
const jobs = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
describe('media validation and queued messaging', () => {
  it.each([
    'http://cdn.example.com/file',
    'https://127.0.0.1/file',
    'https://2130706433/file',
    'https://[::1]/file',
    'https://localhost/file',
    'https://host.internal/file',
    'https://user:password@cdn.example.com/file',
    'https://cdn.example.com:8443/file',
    'file:///C:/secret',
    'https://cdn.example.com/file#fragment',
  ])('rejects unsafe media URL %s', (value) => expect(publicMediaUrl(value)).toBe(false));
  it.each(['image', 'video', 'document', 'audio'])(
    'queues and dispatches %s with the correct provider payload',
    async (type) => {
      const f = await fixture();
      await ingestMeta(incoming(f));
      const value = media(type),
        response = await send(f, value);
      expect(response.status).toBe(202);
      const job = (await jobs(f))[0];
      expect(job.payload).toMatchObject({
        payload: {
          type,
          [type]: {
            link: value.url,
            ...(value.caption ? { caption: value.caption } : {}),
            ...(value.filename ? { filename: value.filename } : {}),
          },
        },
      });
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ messages: [{ id: `wamid.media.${randomUUID()}` }] })),
          ),
      );
      await processJob(job);
      await processJob(job);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: response.body.id } })).type,
      ).toBe(type);
    },
  );
  it('preserves idempotency and rejects changed content under the same key', async () => {
    const f = await fixture();
    await ingestMeta(incoming(f));
    const key = randomUUID(),
      first = await send(f, media(), key),
      second = await send(f, media(), key);
    expect(first.status).toBe(202);
    expect(second.body.id).toBe(first.body.id);
    expect(await jobs(f)).toHaveLength(1);
    expect((await send(f, { ...media(), caption: 'Changed' }, key)).status).toBe(409);
  });
  it('requires a recipient-specific incoming window and rechecks expiry before sending', async () => {
    const f = await fixture();
    expect((await send(f)).status).toBe(409);
    await ingestMeta(incoming(f));
    expect((await send(f)).status).toBe(202);
    await db.whatsappMessageLogs.updateMany({
      where: { vendorId: f.vendorId, isIncomingMessage: true },
      data: { messagedAt: new Date(Date.now() - 25 * 3600000) },
    });
    vi.stubGlobal('fetch', vi.fn());
    await expect(processJob((await jobs(f))[0])).rejects.toMatchObject({
      code: 'TEMPLATE_REQUIRED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid audio captions, filename traversal, controls and unsupported media', async () => {
    const f = await fixture();
    await ingestMeta(incoming(f));
    for (const value of [
      { ...media('audio'), caption: 'Invalid' },
      { ...media('document'), filename: '../secret.pdf' },
      { ...media(), filename: 'Image.png' },
      { ...media(), caption: 'Bad\u0000caption' },
      { ...media(), caption: 'x'.repeat(1025) },
      { ...media(), type: 'sticker' },
      { ...media(), url: 'https://localhost/file' },
    ])
      expect((await send(f, value)).status).toBe(400);
    expect(await jobs(f)).toHaveLength(0);
  });
  it('denies foreign contacts and cancels a queued media send after recipient changes', async () => {
    const f = await fixture(),
      foreign = await fixture();
    await ingestMeta(incoming(f));
    expect(
      (
        await request(app)
          .post(`${f.prefix}/messages/send`)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', randomUUID())
          .send({
            contactId: foreign.contact.id,
            phoneNumberId: f.phone,
            kind: 'media',
            media: media(),
          })
      ).status,
    ).toBe(404);
    expect((await send(f)).status).toBe(202);
    await db.contacts.update({ where: { id: f.contact.id }, data: { waId: '919999999999' } });
    vi.stubGlobal('fetch', vi.fn());
    const job = (await jobs(f))[0];
    await processJob(job);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (job.payload as any).messageId },
        })
      ).status,
    ).toBe('cancelled');
  });
});
describe('graph media nodes', () => {
  async function create(f: Fixture, graph: unknown) {
    return request(app).post(`${f.prefix}/bot-flows`).set('Authorization', f.auth).send({
      title: 'Media graph',
      enabled: true,
      triggerType: 'is',
      startTrigger: 'hello',
      phoneNumberId: f.phone,
      graph,
    });
  }
  it('renders media captions, continues to text and cancels after a graph edit', async () => {
    const f = await fixture(),
      graph = {
        start_node: 'media',
        nodes: [
          {
            id: 'media',
            type: 'media_message',
            payload: {
              media_type: 'document',
              media_url: 'https://cdn.example.com/report.pdf',
              filename: 'Report.pdf',
              caption: 'Hello {first_name}',
            },
            next_node: 'done',
          },
          { id: 'done', type: 'message', payload: { text: 'Done' }, next_node: null },
        ],
      };
    const created = await create(f, graph);
    expect(created.status).toBe(201);
    const event = incoming(f);
    await ingestMeta(event);
    await ingestMeta(event);
    expect(await jobs(f)).toHaveLength(2);
    expect((await jobs(f))[0].payload).toMatchObject({
      payload: {
        type: 'document',
        document: { caption: 'Hello Customer', filename: 'Report.pdf' },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.graph-media.${randomUUID()}` }] })),
        ),
    );
    await processJob((await jobs(f))[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await db.botFlows.update({
      where: { id: created.body.id },
      data: { status: 'inactive', updatedAt: new Date() },
    });
    vi.stubGlobal('fetch', vi.fn());
    await processJob((await jobs(f))[1]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks an oversized rendered caption without advancing the question', async () => {
    const f = await fixture(),
      graph = {
        start_node: 'ask',
        nodes: [
          {
            id: 'ask',
            type: 'question',
            payload: { text: 'Caption?', variable_name: 'answer' },
            next_node: 'media',
          },
          {
            id: 'media',
            type: 'media_message',
            payload: {
              media_type: 'image',
              media_url: 'https://cdn.example.com/image.png',
              caption: '{answer}',
            },
            next_node: null,
          },
        ],
      };
    expect((await create(f, graph)).status).toBe(201);
    await ingestMeta(incoming(f));
    await ingestMeta(incoming(f, 'x'.repeat(1025)));
    expect(await jobs(f)).toHaveLength(1);
    expect(
      await db.outboxJobs.findFirst({
        where: {
          vendorId: f.vendorId,
          kind: 'bot-flow-blocked',
          lastError: 'GRAPH_RENDER_INVALID',
        },
      }),
    ).toBeTruthy();
    expect(
      (
        await db.userActiveFlows.findFirstOrThrow({
          where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
        })
      ).currentNodeUid,
    ).toBe('ask');
  });
});
