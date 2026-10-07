import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { digest, encrypt } from '../src/utils/crypto.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const f = await businessFixture(),
    phone = `7744${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('interactive-test'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9196${String(f.vendorId).padStart(7, '0')}`,
      platform: 'whatsapp',
      wabPhoneNumberId: phone,
    },
  });
  return {
    ...f,
    phone,
    contact,
    auth: `Bearer ${f.token}`,
    path: `/api/v1/vendors/${f.vendorId}/messages/send`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const buttons = () => ({
  type: 'button',
  body: 'Choose an option',
  header: { type: 'text', text: 'Welcome' },
  footer: 'Thank you',
  buttons: [
    { id: 'yes', title: 'Yes' },
    { id: 'no', title: 'No' },
  ],
});
const list = () => ({
  type: 'list',
  body: 'Choose a service',
  buttonText: 'Services',
  sections: [
    {
      title: 'Support',
      rows: [{ id: 'billing', title: 'Billing', description: 'Invoice questions' }],
    },
    { title: 'Sales', rows: [{ id: 'pricing', title: 'Pricing' }] },
  ],
});
const send = (f: Fixture, interactive: any = buttons(), key = randomUUID()) =>
  request(app)
    .post(f.path)
    .set('Authorization', f.auth)
    .set('Idempotency-Key', key)
    .send({ contactId: f.contact.id, phoneNumberId: f.phone, kind: 'interactive', interactive });
const jobs = (f: Fixture) =>
  db.outboxJobs.findMany({ where: { vendorId: f.vendorId, kind: 'whatsapp-send' } });
const event = (f: Fixture, message: any = { type: 'text', text: { body: 'hello' } }) => ({
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
                timestamp: String(Math.floor(Date.now() / 1000)),
                ...message,
              },
            ],
          },
        },
      ],
    },
  ],
});
const remote = () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: `wamid.interactive.${randomUUID()}` }] })),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const tokens = (payload: any): string[] =>
  payload.interactive.type === 'button'
    ? payload.interactive.action.buttons.map((b: any) => b.reply.id)
    : payload.interactive.action.sections.flatMap((s: any) => s.rows.map((r: any) => r.id));
async function replies(f: Fixture) {
  return db.whatsappMessageLogs.findMany({
    where: { vendorId: f.vendorId, isIncomingMessage: true, type: 'interactive' },
  });
}

describe('native standalone interactive messaging', () => {
  for (const type of ['button', 'list'])
    it(`queues ${type} payloads with opaque choices and delivers once`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      const value = type === 'button' ? buttons() : list(),
        response = await send(f, value);
      expect(response.status).toBe(202);
      const job = (await jobs(f))[0],
        payload = (job.payload as any).payload,
        ids = tokens(payload);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      ids.forEach((id) => expect(id).toMatch(/^ni_[A-Za-z0-9_-]{64}$/));
      expect(payload).toMatchObject({
        type: 'interactive',
        interactive: { type, body: { text: value.body } },
      });
      if (type === 'button')
        expect(payload.interactive).toMatchObject({
          header: { type: 'text', text: 'Welcome' },
          footer: { text: 'Thank you' },
          action: {
            buttons: [
              { type: 'reply', reply: { title: 'Yes' } },
              { type: 'reply', reply: { title: 'No' } },
            ],
          },
        });
      else
        expect(payload.interactive.action).toMatchObject({
          button: 'Services',
          sections: [
            { title: 'Support', rows: [{ title: 'Billing', description: 'Invoice questions' }] },
            { title: 'Sales', rows: [{ title: 'Pricing' }] },
          ],
        });
      const fetch = remote();
      await processJob(job);
      await processJob(job);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetch.mock.calls[0][1].body).interactive).toEqual(payload.interactive);
      expect(
        (await db.whatsappMessageLogs.findUniqueOrThrow({ where: { id: response.body.id } }))
          .status,
      ).toBe('sent');
      expect(
        await db.nativeIdempotency.count({
          where: { vendorId: f.vendorId, key: { startsWith: 'interactive-choice:' } },
        }),
      ).toBe(2);
    });
  for (const type of ['image', 'video', 'document'])
    it(`supports public ${type} headers on reply buttons`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      const header = {
        type,
        url: `https://cdn.whalexy.com/file.${type}`,
        ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
      };
      expect((await send(f, { ...buttons(), header })).status).toBe(202);
      expect((await jobs(f))[0].payload).toMatchObject({
        payload: {
          interactive: {
            header: {
              type,
              [type]: {
                link: header.url,
                ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
              },
            },
          },
        },
      });
    });
  it('replays the same message/choice proofs and rejects changed idempotent content', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    const key = randomUUID(),
      first = await send(f, buttons(), key),
      before = (await jobs(f))[0].payload;
    expect((await send(f, buttons(), key)).body).toEqual(first.body);
    expect((await jobs(f))[0].payload).toEqual(before);
    expect(await jobs(f)).toHaveLength(1);
    expect((await send(f, { ...buttons(), body: 'Changed' }, key)).status).toBe(409);
    expect(
      await db.nativeIdempotency.count({
        where: { vendorId: f.vendorId, key: { startsWith: 'interactive-choice:' } },
      }),
    ).toBe(2);
  });
  it('requires the selected recipient/number service window and rechecks expiry before dispatch', async () => {
    const f = await fixture();
    expect((await send(f)).status).toBe(409);
    await ingestMeta(event(f));
    expect((await send(f)).status).toBe(202);
    await db.whatsappMessageLogs.updateMany({
      where: { vendorId: f.vendorId, isIncomingMessage: true },
      data: { messagedAt: new Date(Date.now() - 25 * 3600000) },
    });
    const fetch = remote();
    await expect(processJob((await jobs(f))[0])).rejects.toMatchObject({
      code: 'TEMPLATE_REQUIRED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid counts, duplicate choices, controls, unsafe media and incompatible types atomically', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    const bad: any[] = [
      { ...buttons(), buttons: [] },
      {
        ...buttons(),
        buttons: Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, title: `B${i}` })),
      },
      {
        ...buttons(),
        buttons: [
          { id: 'x', title: 'A' },
          { id: 'x', title: 'B' },
        ],
      },
      {
        ...buttons(),
        buttons: [
          { id: 'x', title: 'Same' },
          { id: 'y', title: 'Same' },
        ],
      },
      { ...buttons(), buttons: [{ id: 'x', title: 'x'.repeat(21) }] },
      { ...buttons(), body: 'x'.repeat(1025) },
      { ...buttons(), footer: 'bad\u0000footer' },
      { ...buttons(), sections: list().sections },
      { ...buttons(), header: { type: 'image', url: 'http://cdn.whalexy.com/file' } },
      {
        ...buttons(),
        header: { type: 'document', url: 'https://cdn.whalexy.com/file', filename: '../file.pdf' },
      },
      {
        ...buttons(),
        header: { type: 'text', text: 'Header', url: 'https://cdn.whalexy.com/file' },
      },
      { ...list(), header: { type: 'image', url: 'https://cdn.whalexy.com/file' } },
      {
        ...list(),
        sections: [
          { title: 'A', rows: [{ id: 'x', title: 'X' }] },
          { title: 'B', rows: [{ id: 'x', title: 'X' }] },
        ],
      },
      {
        ...list(),
        sections: [
          {
            title: 'A',
            rows: Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, title: 'Row' })),
          },
          { title: 'B', rows: [{ id: 'b', title: 'Row' }] },
        ],
      },
      { ...list(), buttonText: '' },
      { ...buttons(), type: 'cta_url' },
    ];
    for (const value of bad) expect((await send(f, value)).status).toBe(400);
    expect(await jobs(f)).toHaveLength(0);
    expect(await db.nativeIdempotency.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('accepts exactly ten rows across sections and prevents sender-supplied provider IDs', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `row_${i}`, title: `Row ${i}` }));
    expect(
      (
        await send(f, {
          ...list(),
          sections: [
            { title: 'A', rows: rows.slice(0, 5) },
            { title: 'B', rows: rows.slice(5) },
          ],
        })
      ).status,
    ).toBe(202);
    const ids = tokens(((await jobs(f))[0].payload as any).payload);
    expect(ids).toHaveLength(10);
    expect(ids.some((id) => rows.some((row) => row.id === id))).toBe(false);
  });
  for (const type of ['button', 'list'])
    it(`records bound ${type} selections once using configured titles rather than webhook labels`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      await send(f, type === 'button' ? buttons() : list());
      const job = (await jobs(f))[0];
      remote();
      await processJob(job);
      const original = await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (job.payload as any).messageId },
        }),
        token = tokens((job.payload as any).payload)[0];
      const reply = event(f, {
        type: 'interactive',
        context: { id: original.whatsappMessageId },
        interactive: {
          [type === 'button' ? 'button_reply' : 'list_reply']: {
            id: token,
            title: 'Untrusted label',
          },
        },
      });
      await Promise.all([ingestMeta(reply), ingestMeta(reply)]);
      const rows = await replies(f);
      expect(rows).toHaveLength(1);
      expect(rows[0].data).toMatchObject({
        nativeInteractiveSelection: {
          messageId: original.id,
          choiceId: type === 'button' ? 'yes' : 'billing',
          title: type === 'button' ? 'Yes' : 'Billing',
          type,
        },
      });
      expect(rows[0].message).toBe(type === 'button' ? 'Yes' : 'Billing');
      expect(await jobs(f)).toHaveLength(1);
    });
  it('records an early signed selection before send acknowledgement without repeating delivery', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    await send(f);
    const job = (await jobs(f))[0],
      token = tokens((job.payload as any).payload)[0];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await ingestMeta(
          event(f, {
            type: 'interactive',
            context: { id: 'wamid.early' },
            interactive: { button_reply: { id: token } },
          }),
        );
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.early' }] }));
      }),
    );
    await processJob(job);
    await processJob(job);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await replies(f))[0].data).toHaveProperty('nativeInteractiveSelection');
  });
  it('rejects unknown, expired, wrong-type, wrong-context and foreign recipient/number selection proofs', async () => {
    const f = await fixture();
    await ingestMeta(event(f));
    await send(f);
    const job = (await jobs(f))[0],
      token = tokens((job.payload as any).payload)[0];
    remote();
    await processJob(job);
    const proof = await db.nativeIdempotency.findUniqueOrThrow({
      where: { vendorId_key: { vendorId: f.vendorId, key: `interactive-choice:${digest(token)}` } },
    });
    const another = await fixture();
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: `${f.phone}9`,
        secret: encrypt('other-number'),
      },
    });
    for (const input of [
      { ...f, contact: { ...f.contact, waId: '919000111222' } },
      { ...f, phone: `${f.phone}9` },
      another,
    ])
      await ingestMeta(
        event(input, { type: 'interactive', interactive: { button_reply: { id: token } } }),
      );
    await ingestMeta(
      event(f, {
        type: 'interactive',
        interactive: { button_reply: { id: `ni_${'X'.repeat(64)}` } },
      }),
    );
    await ingestMeta(event(f, { type: 'interactive', interactive: { list_reply: { id: token } } }));
    await ingestMeta(
      event(f, {
        type: 'interactive',
        context: { id: 'wrong-provider-message' },
        interactive: { button_reply: { id: token } },
      }),
    );
    await db.nativeIdempotency.update({
      where: { id: proof.id },
      data: { response: { ...(proof.response as any), expiresAt: Date.now() - 1000 } },
    });
    await ingestMeta(
      event(f, { type: 'interactive', interactive: { button_reply: { id: token } } }),
    );
    const all = await db.whatsappMessageLogs.findMany({
      where: {
        vendorId: { in: [f.vendorId, another.vendorId] },
        type: 'interactive',
        isIncomingMessage: true,
      },
    });
    expect(all.every((row) => !(row.data as any)?.nativeInteractiveSelection)).toBe(true);
  });
  for (const change of ['recipient', 'expired', 'revoked', 'disconnected'])
    it(`prevents queued interactive delivery after ${change} changes`, async () => {
      const f = await fixture();
      await ingestMeta(event(f));
      await send(f);
      const job = (await jobs(f))[0];
      if (change === 'recipient')
        await db.contacts.update({ where: { id: f.contact.id }, data: { waId: '919000111222' } });
      if (change === 'expired')
        await db.outboxJobs.update({
          where: { id: job.id },
          data: {
            payload: {
              ...(job.payload as any),
              nativeInteractive: { expiresAt: Date.now() - 1000 },
            },
          },
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
      const fetch = remote(),
        current = await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } });
      if (change === 'revoked' || change === 'disconnected')
        await expect(processJob(current)).rejects.toBeTruthy();
      else await processJob(current);
      expect(fetch).not.toHaveBeenCalled();
    });
  it('denies foreign and unassigned contacts and mismatched number scope', async () => {
    const f = await fixture(),
      other = await fixture();
    await ingestMeta(event(f));
    expect((await send({ ...f, contact: other.contact })).status).toBe(404);
    expect((await send({ ...f, phone: `${f.phone}9` })).status).toBe(409);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: { permissions: ['vendor.chats.reply', 'vendor.chats.view_assigned'] },
    });
    expect((await send(f)).status).toBe(404);
    expect(await jobs(f)).toHaveLength(0);
  });
  it('keeps standalone choices separate from an active bot menu even when caller IDs match', async () => {
    const f = await fixture(),
      graph = {
        start_node: 'menu',
        nodes: [
          {
            id: 'menu',
            type: 'interactive',
            payload: {
              text: 'Bot menu',
              interactive_type: 'button',
              buttons: [{ id: 'next', title: 'Continue', next_node: 'done' }],
            },
            next_node: null,
          },
          { id: 'done', type: 'message', payload: { text: 'Bot advanced' }, next_node: null },
        ],
      };
    const flow = await request(app)
      .post(`/api/v1/vendors/${f.vendorId}/bot-flows`)
      .set('Authorization', f.auth)
      .send({
        title: 'Separate menu',
        enabled: true,
        triggerType: 'is',
        startTrigger: 'hello',
        phoneNumberId: f.phone,
        graph,
      });
    expect(flow.status).toBe(201);
    await ingestMeta(event(f));
    const menu = (await jobs(f))[0],
      graphToken = tokens((menu.payload as any).payload)[0];
    expect(
      (await send(f, { ...buttons(), buttons: [{ id: graphToken, title: 'Human option' }] }))
        .status,
    ).toBe(202);
    const manual = (await jobs(f)).find((job) => !(job.payload as any).botFlowId)!,
      token = tokens((manual.payload as any).payload)[0];
    expect(token).not.toBe(graphToken);
    await ingestMeta(
      event(f, { type: 'interactive', interactive: { button_reply: { id: token } } }),
    );
    await ingestMeta(
      event(f, {
        type: 'interactive',
        interactive: { button_reply: { id: `ni_${'Z'.repeat(64)}` } },
      }),
    );
    expect(await jobs(f)).toHaveLength(2);
    expect(
      (await db.userActiveFlows.findFirstOrThrow({ where: { flowId: flow.body.id } }))
        .currentNodeUid,
    ).toBe('menu');
    expect((await replies(f))[0].data).toMatchObject({
      nativeInteractiveSelection: { choiceId: graphToken },
    });
    await ingestMeta(
      event(f, { type: 'interactive', interactive: { button_reply: { id: graphToken } } }),
    );
    expect(await jobs(f)).toHaveLength(3);
  });
});
