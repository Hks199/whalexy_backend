import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { validateGraph } from '../src/modules/bot-flows/services/graph-schema.validation.js';
import { resumeGraphFlow } from '../src/modules/bot-flows/services/bot-graph-runtime.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
async function fixture(category = 'UTILITY') {
  const f = await businessFixture(),
    phone = `7755${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-bot-template'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: `9199${String(f.vendorId).padStart(7, '0')}`,
      firstName: 'Jane',
    },
  });
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: f.vendorId,
      templateName: 'native_bot_test',
      languageCode: 'en',
      category,
      status: 'APPROVED',
      data: { components: [{ type: 'BODY', text: 'Hello {{1}}' }] },
    },
  });
  return {
    ...f,
    phone,
    contact,
    template,
    auth: `Bearer ${f.token}`,
    prefix: `/api/v1/vendors/${f.vendorId}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const graph = (f: Fixture, parameters: any[] = [{ contactField: 'firstName' }]) => ({
  start_node: 'template',
  nodes: [
    {
      id: 'template',
      type: 'whatsapp_template',
      payload: { whatsapp_template_id: f.template.id, bodyParameters: parameters },
      next_node: 'question',
    },
    {
      id: 'question',
      type: 'question',
      payload: { text: 'Anything else?', variable_name: 'answer' },
      next_node: null,
    },
  ],
});
const create = (f: Fixture, g: any = graph(f)) =>
  request(app).post(`${f.prefix}/bot-flows`).set('Authorization', f.auth).send({
    title: 'Template flow',
    enabled: true,
    triggerType: 'is',
    startTrigger: 'hello',
    phoneNumberId: f.phone,
    graph: g,
  });
const inbound = (f: Fixture, text = 'hello') => ({
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
                type: 'text',
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});
const queue = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
async function richFixture(type: 'image' | 'video' | 'document') {
  const f = await fixture();
  await db.whatsappTemplates.update({
    where: { id: f.template.id },
    data: {
      updatedAt: new Date(),
      data: {
        components: [
          { type: 'HEADER', format: type.toUpperCase() },
          { type: 'BODY', text: 'Hello {{1}}' },
          {
            type: 'BUTTONS',
            buttons: [
              { type: 'QUICK_REPLY', text: 'Thanks' },
              { type: 'URL', text: 'View', url: 'https://shop.whalexy.com/{{1}}' },
              { type: 'COPY_CODE', text: 'Copy' },
            ],
          },
        ],
      },
    },
  });
  const g: any = graph(f);
  Object.assign(g.nodes[0].payload, {
    mediaHeader: {
      type,
      url: `https://cdn.whalexy.com/bot.${type === 'document' ? 'pdf' : type === 'image' ? 'png' : 'mp4'}`,
      ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
    },
    buttonParameters: [{ index: 1, value: { contactField: 'phone' } }],
    copyCode: 'SAVE10',
  });
  return { ...f, g };
}
describe('native graph template messages', () => {
  it('queues owned approved templates once, renders contact fields and continues to a question', async () => {
    const f = await fixture();
    expect((await create(f)).status).toBe(201);
    const event = inbound(f);
    await Promise.all([ingestMeta(event), ingestMeta(event)]);
    const jobs = await queue(f);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].payload).toMatchObject({
      nativeGraphTemplate: { templateId: f.template.id },
      payload: {
        type: 'template',
        template: {
          name: 'native_bot_test',
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'Jane' }] }],
        },
      },
    });
    expect((jobs[0].payload as any).payload.nativeGraphTemplate).toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: 'wamid.native.template' }] })),
        ),
    );
    await processJob(jobs[0]);
    await processJob(jobs[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetch as any).mock.calls[0][1].body).nativeGraphTemplate).toBeUndefined();
    expect(
      await db.userActiveFlows.findFirst({ where: { flowId: (jobs[0].payload as any).botFlowId } }),
    ).toMatchObject({ currentNodeUid: 'question' });
  });
  it('rejects foreign, unapproved and unsynchronized template definitions', async () => {
    const f = await fixture(),
      foreign = await fixture();
    const g = graph(f);
    g.nodes[0].payload.whatsapp_template_id = foreign.template.id;
    expect((await create(f, g)).status).toBe(409);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { status: 'REJECTED' },
    });
    expect((await create(f)).status).toBe(409);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { status: 'APPROVED', data: {} },
    });
    expect((await create(f)).status).toBe(409);
    expect(await db.botFlows.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rejects mismatched parameters, foreign custom fields, missing media mappings and automatic cycles', async () => {
    const f = await fixture(),
      foreign = await fixture();
    expect((await create(f, graph(f, []))).status).toBe(409);
    const field = await db.contactCustomFields.create({
      data: {
        vendorId: foreign.vendorId,
        inputName: 'foreign',
        name: 'Foreign',
        inputType: 'text',
      },
    });
    expect((await create(f, graph(f, [{ customFieldId: field.id }]))).status).toBe(400);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: {
        data: {
          components: [
            { type: 'HEADER', format: 'IMAGE' },
            { type: 'BODY', text: '{{1}}' },
          ],
        },
      },
    });
    expect((await create(f)).status).toBe(409);
    const g = graph(f);
    g.nodes[0].next_node = 'template';
    expect(() => validateGraph(g, true)).toThrow();
  });
  it('renders captured variables and owned custom values without modifying preview data', async () => {
    const f = await fixture(),
      field = await db.contactCustomFields.create({
        data: {
          vendorId: f.vendorId,
          inputName: 'reference',
          name: 'Reference',
          inputType: 'text',
        },
      });
    await db.contactCustomFieldValues.create({
      data: { contactId: f.contact.id, contactCustomFieldsId: field.id, fieldValue: 'REF-42' },
    });
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { data: { components: [{ type: 'BODY', text: '{{1}} {{2}}' }] } },
    });
    const g: any = graph(f, [{ literal: 'Answer: {answer}' }, { customFieldId: field.id }]);
    g.start_node = 'ask';
    g.nodes.unshift({
      id: 'ask',
      type: 'question',
      payload: { text: 'Name?', variable_name: 'answer' },
      next_node: 'template',
    });
    const created = await create(f, g);
    expect(created.status).toBe(201);
    const preview = await request(app)
      .post(`${f.prefix}/bot-flows/${created.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({ inputs: [{ text: 'Alex' }] });
    expect(preview.status).toBe(200);
    expect(preview.body.responses[1].messages[0].graphTemplate.bodyParameters[0].literal).toBe(
      'Answer: Alex',
    );
    expect(await queue(f)).toHaveLength(0);
    await ingestMeta(inbound(f));
    await ingestMeta(inbound(f, 'Alex'));
    expect((await queue(f))[1].payload).toMatchObject({
      payload: {
        template: { components: [{ parameters: [{ text: 'Answer: Alex' }, { text: 'REF-42' }] }] },
      },
    });
  });
  it('blocks the whole graph step when a captured value violates provider limits', async () => {
    const f = await fixture(),
      g: any = graph(f, [{ literal: '{answer}' }]);
    g.start_node = 'ask';
    g.nodes.unshift({
      id: 'ask',
      type: 'question',
      payload: { text: 'Name?', variable_name: 'answer' },
      next_node: 'template',
    });
    await create(f, g);
    await ingestMeta(inbound(f));
    await ingestMeta(inbound(f, 'x'.repeat(1025)));
    expect(await queue(f)).toHaveLength(1);
    expect(
      await db.outboxJobs.findFirst({ where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' } }),
    ).toMatchObject({ status: 'blocked' });
    expect(
      (
        await db.userActiveFlows.findFirstOrThrow({
          where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
        })
      ).currentNodeUid,
    ).toBe('ask');
  });
  for (const change of ['revision', 'status', 'opt-out'] as const)
    it(`cancels prepared templates after ${change} changes`, async () => {
      const f = await fixture('MARKETING');
      await create(f);
      await ingestMeta(inbound(f));
      const job = (await queue(f))[0];
      if (change === 'opt-out')
        await db.contacts.create({
          data: {
            vendorId: f.vendorId,
            waId: f.contact.waId,
            whatsappOptOut: 1,
            wabPhoneNumberId: f.phone,
          },
        });
      else
        await db.whatsappTemplates.update({
          where: { id: f.template.id },
          data:
            change === 'revision'
              ? { updatedAt: new Date(Date.now() + 1000) }
              : { status: 'PAUSED' },
        });
      vi.stubGlobal('fetch', vi.fn());
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
  it('blocks opted-out marketing before queueing while allowing utility templates', async () => {
    const f = await fixture('MARKETING');
    await create(f);
    await db.contacts.update({ where: { id: f.contact.id }, data: { whatsappOptOut: 1 } });
    await ingestMeta(inbound(f));
    expect(await queue(f)).toHaveLength(0);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { category: 'UTILITY' },
    });
    await ingestMeta(inbound(f));
    expect(await queue(f)).toHaveLength(2);
  });
  it('resolves templates after a durable delay and refuses revoked approval before advancing', async () => {
    const f = await fixture(),
      g: any = graph(f);
    g.start_node = 'wait';
    g.nodes.unshift({ id: 'wait', type: 'wait', payload: { wait_time: 5 }, next_node: 'template' });
    await create(f, g);
    await ingestMeta(inbound(f));
    const job = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, kind: 'bot-flow-resume' },
    });
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { status: 'REJECTED' },
    });
    await expect(
      resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100)),
    ).rejects.toMatchObject({ code: 'GRAPH_TEMPLATE_UNAVAILABLE' });
    expect(await queue(f)).toHaveLength(1);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { status: 'APPROVED' },
    });
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    expect(await queue(f)).toHaveLength(3);
  });
  for (const type of ['image', 'video', 'document'] as const)
    it(`renders ${type} bot headers, indexed URL buttons and coupons through one guarded send`, async () => {
      const f = await richFixture(type);
      expect((await create(f, f.g)).status).toBe(201);
      const event = inbound(f);
      await Promise.all([ingestMeta(event), ingestMeta(event)]);
      const jobs = await queue(f);
      expect(jobs).toHaveLength(2);
      const components = [
        {
          type: 'header',
          parameters: [
            {
              type,
              [type]: {
                link: f.g.nodes[0].payload.mediaHeader.url,
                ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
              },
            },
          ],
        },
        { type: 'body', parameters: [{ type: 'text', text: 'Jane' }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '1',
          parameters: [{ type: 'text', text: f.contact.waId }],
        },
        {
          type: 'button',
          sub_type: 'copy_code',
          index: '2',
          parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }],
        },
      ];
      expect((jobs[0].payload as any).payload.template.components).toEqual(components);
      const send = vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({ messages: [{ id: `wamid.rich.bot.${type}.${f.vendorId}` }] }),
            ),
        );
      vi.stubGlobal('fetch', send);
      await processJob(jobs[0]);
      await processJob(jobs[0]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(send.mock.calls[0][1].body).template.components).toEqual(components);
      expect(
        (
          await db.userActiveFlows.findFirstOrThrow({
            where: { flowId: (jobs[0].payload as any).botFlowId },
          })
        ).currentNodeUid,
      ).toBe('question');
    });
  it('renders captured button, coupon and document filename values in previews without private resolution or effects', async () => {
    const f = await richFixture('document'),
      payload = f.g.nodes[0].payload;
    payload.buttonParameters = [{ index: 1, value: { literal: 'order-{answer}' } }];
    payload.copyCode = '{answer}';
    payload.mediaHeader.filename = 'Offer-{answer}.pdf';
    f.g.start_node = 'ask';
    f.g.nodes.unshift({
      id: 'ask',
      type: 'question',
      payload: { text: 'Code?', variable_name: 'answer' },
      next_node: 'template',
    });
    const saved = await create(f, f.g);
    expect(saved.status).toBe(201);
    const preview = await request(app)
      .post(`${f.prefix}/bot-flows/${saved.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({ inputs: [{ text: 'ABC' }] });
    expect(preview.status).toBe(200);
    expect(preview.body.responses[1].messages[0].graphTemplate).toMatchObject({
      mediaHeader: { filename: 'Offer-ABC.pdf' },
      buttonParameters: [{ index: 1, value: { literal: 'order-ABC' } }],
      copyCode: 'ABC',
    });
    expect(await queue(f)).toHaveLength(0);
    expect(await db.userActiveFlows.count({ where: { flowId: saved.body.id } })).toBe(0);
    await ingestMeta(inbound(f));
    await ingestMeta(inbound(f, 'ABC'));
    const jobs = await queue(f);
    expect((jobs[1].payload as any).payload.template.components).toMatchObject([
      { parameters: [{ document: { filename: 'Offer-ABC.pdf' } }] },
      { parameters: [{ text: 'Jane' }] },
      { parameters: [{ text: 'order-ABC' }] },
      { parameters: [{ coupon_code: 'ABC' }] },
    ]);
  });
  it('uses a newly captured owned field in both body and URL button before committing its value', async () => {
    const f = await richFixture('image'),
      field = await db.contactCustomFields.create({
        data: { vendorId: f.vendorId, inputName: 'reference', inputType: 'text' },
      });
    await db.contactCustomFieldValues.create({
      data: { contactId: f.contact.id, contactCustomFieldsId: field.id, fieldValue: 'OLD' },
    });
    f.g.nodes[0].payload.bodyParameters = [{ customFieldId: field.id }];
    f.g.nodes[0].payload.buttonParameters = [{ index: 1, value: { customFieldId: field.id } }];
    f.g.start_node = 'ask';
    f.g.nodes.unshift({
      id: 'ask',
      type: 'question',
      payload: { text: 'Reference?', variable_name: 'answer', store_in_field: 'reference' },
      next_node: 'template',
    });
    expect((await create(f, f.g)).status).toBe(201);
    await ingestMeta(inbound(f));
    const answer = inbound(f, 'NEW');
    await Promise.all([ingestMeta(answer), ingestMeta(answer)]);
    const jobs = await queue(f);
    expect(jobs).toHaveLength(3);
    const components = (jobs[1].payload as any).payload.template.components;
    expect(components[1].parameters[0].text).toBe('NEW');
    expect(components[2].parameters[0].text).toBe('NEW');
    expect(
      (
        await db.contactCustomFieldValues.findFirstOrThrow({
          where: { contactId: f.contact.id, contactCustomFieldsId: field.id },
        })
      ).fieldValue,
    ).toBe('NEW');
  });
  for (const target of ['coupon', 'filename', 'button'] as const)
    it(`preserves stored answers and graph progress when rendered ${target} values are invalid`, async () => {
      const f = await richFixture('document'),
        field = await db.contactCustomFields.create({
          data: { vendorId: f.vendorId, inputName: 'reference', inputType: 'text' },
        });
      await db.contactCustomFieldValues.create({
        data: { contactId: f.contact.id, contactCustomFieldsId: field.id, fieldValue: 'OLD' },
      });
      if (target === 'coupon') f.g.nodes[0].payload.copyCode = '{answer}';
      if (target === 'filename') f.g.nodes[0].payload.mediaHeader.filename = '{answer}.pdf';
      if (target === 'button')
        f.g.nodes[0].payload.buttonParameters = [{ index: 1, value: { customFieldId: field.id } }];
      f.g.start_node = 'ask';
      f.g.nodes.unshift({
        id: 'ask',
        type: 'question',
        payload: {
          text: 'Reference?',
          variable_name: 'answer',
          store_in_field: 'reference',
          validation_rules: { max_length: 4096 },
        },
        next_node: 'template',
      });
      expect((await create(f, f.g)).status).toBe(201);
      await ingestMeta(inbound(f));
      await ingestMeta(
        inbound(
          f,
          target === 'filename' ? '../unsafe' : 'X'.repeat(target === 'button' ? 1025 : 16),
        ),
      );
      expect(await queue(f)).toHaveLength(1);
      expect(
        (
          await db.userActiveFlows.findFirstOrThrow({
            where: { phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` } },
          })
        ).currentNodeUid,
      ).toBe('ask');
      expect(
        (
          await db.contactCustomFieldValues.findFirstOrThrow({
            where: { contactId: f.contact.id, contactCustomFieldsId: field.id },
          })
        ).fieldValue,
      ).toBe('OLD');
      expect(
        await db.outboxJobs.findFirst({
          where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' },
        }),
      ).toMatchObject({ status: 'blocked' });
    });
  it('rejects foreign button fields and wrong media/button/coupon mappings at graph save', async () => {
    const f = await richFixture('document'),
      other = await fixture(),
      field = await db.contactCustomFields.create({
        data: { vendorId: other.vendorId, inputName: 'foreign', inputType: 'text' },
      });
    for (const change of [
      { buttonParameters: [{ index: 1, value: { customFieldId: field.id } }] },
      { buttonParameters: [] },
      { buttonParameters: [{ index: 0, value: { literal: 'wrong' } }] },
      {
        buttonParameters: [
          f.g.nodes[0].payload.buttonParameters[0],
          f.g.nodes[0].payload.buttonParameters[0],
        ],
      },
      { copyCode: undefined },
      { mediaHeader: undefined },
      { mediaHeader: { type: 'image', url: 'https://cdn.whalexy.com/image.png' } },
      {
        mediaHeader: { type: 'document', url: 'https://127.0.0.1/file.pdf', filename: 'file.pdf' },
      },
    ]) {
      const g = structuredClone(f.g);
      Object.assign(g.nodes[0].payload, change);
      expect([400, 409]).toContain((await create(f, g)).status);
    }
    expect(await db.botFlows.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('cancels a prepared rich template after its graph media settings change', async () => {
    const f = await richFixture('image'),
      saved = await create(f, f.g);
    expect(saved.status).toBe(201);
    await ingestMeta(inbound(f));
    const job = (await queue(f))[0];
    f.g.nodes[0].payload.mediaHeader.url = 'https://cdn.whalexy.com/updated.png';
    const updated = await request(app)
      .put(`${f.prefix}/bot-flows/${saved.body.id}`)
      .set('Authorization', f.auth)
      .send({
        title: 'Changed',
        enabled: true,
        triggerType: 'is',
        startTrigger: 'hello',
        phoneNumberId: f.phone,
        graph: f.g,
      });
    expect(updated.status).toBe(200);
    vi.stubGlobal('fetch', vi.fn());
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
  it('revalidates rich templates after a durable wait and resumes only once', async () => {
    const f = await richFixture('image');
    f.g.start_node = 'wait';
    f.g.nodes.unshift({
      id: 'wait',
      type: 'wait',
      payload: { wait_time: 5 },
      next_node: 'template',
    });
    expect((await create(f, f.g)).status).toBe(201);
    await ingestMeta(inbound(f));
    const job = await db.outboxJobs.findFirstOrThrow({
        where: { vendorId: f.vendorId, kind: 'bot-flow-resume' },
      }),
      data = f.template.data as any;
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: {
        data: {
          components: [
            { type: 'HEADER', format: 'VIDEO' },
            { type: 'BODY', text: '{{1}}' },
          ],
        },
      },
    });
    await expect(
      resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100)),
    ).rejects.toMatchObject({ code: 'RICH_TEMPLATE_MAPPING' });
    expect(await queue(f)).toHaveLength(1);
    // Restore the exact synchronized definition, including its URL/coupon buttons.
    const components = [
      { type: 'HEADER', format: 'IMAGE' },
      ...data.components,
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Thanks' },
          { type: 'URL', text: 'View', url: 'https://shop.whalexy.com/{{1}}' },
          { type: 'COPY_CODE', text: 'Copy' },
        ],
      },
    ];
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { data: { components }, updatedAt: new Date() },
    });
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    await resumeGraphFlow(job, new Date(job.availableAt.getTime() + 100));
    expect(await queue(f)).toHaveLength(3);
    expect((await queue(f))[1].payload).toMatchObject({
      payload: {
        template: {
          components: [
            { type: 'header' },
            { type: 'body' },
            { type: 'button' },
            { type: 'button' },
          ],
        },
      },
    });
  });
});
