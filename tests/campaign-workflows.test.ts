import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { createApp } from '../src/app.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { dispatchDueCampaigns } from '../src/modules/campaigns/services/campaign-delivery.service.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
async function fixture(size = 1, parameterized = false) {
  const owner = await businessFixture(),
    phone = `5588${owner.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: owner.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('campaign-test-credential'),
    },
  });
  const group = await db.contactGroups.create({
    data: { vendorId: owner.vendorId, title: 'Audience', wabPhoneNumberId: phone },
  });
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: owner.vendorId,
      templateName: 'native_campaign',
      languageCode: 'en',
      category: 'MARKETING',
      status: 'APPROVED',
      data: {
        components: [
          { type: 'BODY', text: parameterized ? 'Hello {{1}}, reference {{2}}' : 'Hello' },
        ],
      },
    },
  });
  const contacts = await db.contacts.createManyAndReturn({
    data: Array.from({ length: size }, (_, i) => ({
      vendorId: owner.vendorId,
      firstName: `Person ${i}`,
      waId: `9198${String(owner.vendorId).padStart(5, '0')}${String(i).padStart(4, '0')}`,
      languageCode: 'en',
    })),
    select: { id: true },
  });
  await db.groupContacts.createMany({
    data: contacts.map((contact) => ({ groupId: group.id, contactId: contact.id })),
  });
  const path = `/api/v1/vendors/${owner.vendorId}/campaigns`,
    auth = `Bearer ${owner.token}`;
  const body = {
    title: 'Campaign',
    templateId: template.id,
    phoneNumberId: phone,
    groupIds: [group.id],
    requireTest: false,
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  };
  return { ...owner, phone, group, template, contacts, path, auth, body };
}
async function create(f: Awaited<ReturnType<typeof fixture>>, extra = {}) {
  const response = await request(app)
    .post(f.path)
    .set('Authorization', f.auth)
    .send({ ...f.body, ...extra });
  expect(response.status).toBe(201);
  await db.campaigns.update({
    where: { id: response.body.id },
    data: { scheduledAt: new Date(0) },
  });
  return response.body.id as number;
}
async function job(vendorId: number, campaignId: number) {
  return db.outboxJobs.findFirstOrThrow({
    where: { vendorId, payload: { path: ['campaignId'], equals: campaignId } },
  });
}
async function richFixture(type: 'image' | 'video' | 'document', size = 1) {
  const f = await fixture(size);
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
              { type: 'URL', url: 'https://shop.whalexy.com/{{1}}', text: 'Order' },
              { type: 'COPY_CODE', text: 'Copy' },
            ],
          },
        ],
      },
    },
  });
  const options = {
    mediaHeader: {
      type,
      url: `https://cdn.whalexy.com/campaign.${type === 'document' ? 'pdf' : type === 'image' ? 'png' : 'mp4'}`,
      ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
    },
    bodyParameters: [{ contactField: 'firstName' }],
    buttonParameters: [{ index: 1, value: { contactField: 'phone' } }],
    copyCode: 'SAVE10',
  };
  return { ...f, options };
}
describe('campaign audiences, values and lifecycle', () => {
  for (const type of ['image', 'video', 'document'] as const)
    it(`uses the same ${type} template for acknowledged tests, audience delivery and fresh copies`, async () => {
      const f = await richFixture(type),
        id = await create(f, { ...f.options, requireTest: true });
      const response = await request(app)
        .post(`${f.path}/${id}/test`)
        .set('Authorization', f.auth)
        .set('Idempotency-Key', `rich_preflight_${type}`)
        .send({ contactId: f.contacts[0].id });
      expect(response.status).toBe(202);
      const test = await db.outboxJobs.findFirstOrThrow({
        where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
      });
      const fetch = vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({ messages: [{ id: `wamid.rich.${type}.${id}.${Math.random()}` }] }),
            ),
        );
      vi.stubGlobal('fetch', fetch);
      await dispatchDueCampaigns(f.vendorId);
      expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(0);
      await processJob(test);
      await processJob(test);
      expect(fetch).toHaveBeenCalledTimes(1);
      await dispatchDueCampaigns(f.vendorId);
      const audience = await job(f.vendorId, id),
        components = (audience.payload as any).payload.template.components;
      expect(components).toEqual((test.payload as any).payload.template.components);
      const contact = await db.contacts.findUniqueOrThrow({ where: { id: f.contacts[0].id } });
      expect(components).toEqual([
        {
          type: 'header',
          parameters: [
            {
              type,
              [type]: {
                link: f.options.mediaHeader.url,
                ...(type === 'document' ? { filename: 'Offer.pdf' } : {}),
              },
            },
          ],
        },
        { type: 'body', parameters: [{ type: 'text', text: 'Person 0' }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '1',
          parameters: [{ type: 'text', text: contact.waId }],
        },
        {
          type: 'button',
          sub_type: 'copy_code',
          index: '2',
          parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }],
        },
      ]);
      await processJob(audience);
      await processJob(audience);
      expect(fetch).toHaveBeenCalledTimes(2);
      const copy = await request(app)
        .post(`${f.path}/${id}/duplicate`)
        .set('Authorization', f.auth)
        .send({ title: 'Copy', scheduledAt: new Date(Date.now() + 3600000).toISOString() });
      expect(copy.status).toBe(201);
      expect(copy.body.status).toBe('awaiting_test');
      const copied = (await db.campaigns.findUniqueOrThrow({ where: { id: copy.body.id } }))
        .data as any;
      expect(copied.mediaHeader).toEqual(f.options.mediaHeader);
      expect(copied.buttonParameters[0]).toMatchObject(f.options.buttonParameters[0]);
      expect(copied.copyCode).toBe('SAVE10');
      expect(copied.testReceipt).toBeUndefined();
    });
  it('renders text headers and owned custom fields in dynamic buttons', async () => {
    const f = await fixture(),
      field = await db.contactCustomFields.create({
        data: { vendorId: f.vendorId, inputName: 'orderReference', inputType: 'text' },
      });
    await db.contactCustomFieldValues.create({
      data: {
        contactId: f.contacts[0].id,
        contactCustomFieldsId: field.id,
        fieldValue: 'order-123',
      },
    });
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: {
        data: {
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
            { type: 'BODY', text: 'Hello' },
            {
              type: 'BUTTONS',
              buttons: [{ type: 'URL', text: 'View', url: 'https://shop.whalexy.com/{{1}}' }],
            },
          ],
        },
      },
    });
    const id = await create(f, {
      headerParameters: [{ contactField: 'firstName' }],
      buttonParameters: [{ index: 0, value: { customFieldId: field.id } }],
    });
    await dispatchDueCampaigns(f.vendorId);
    expect((await job(f.vendorId, id)).payload).toMatchObject({
      payload: {
        template: {
          components: [
            { type: 'header', parameters: [{ type: 'text', text: 'Person 0' }] },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: 'order-123' }],
            },
          ],
        },
      },
    });
  });
  it('rejects foreign custom fields and missing or mismatched rich mappings before creation', async () => {
    const f = await richFixture('document'),
      other = await businessFixture(),
      field = await db.contactCustomFields.create({
        data: { vendorId: other.vendorId, inputName: 'privateReference', inputType: 'text' },
      });
    for (const change of [
      { mediaHeader: undefined },
      { mediaHeader: { type: 'image', url: f.options.mediaHeader.url } },
      { buttonParameters: [] },
      { buttonParameters: [{ index: 0, value: { literal: 'wrong index' } }] },
      { buttonParameters: [{ index: 1, value: { customFieldId: field.id } }] },
      { copyCode: undefined },
    ]) {
      const response = await request(app)
        .post(f.path)
        .set('Authorization', f.auth)
        .send({ ...f.body, ...f.options, ...change });
      expect([400, 409]).toContain(response.status);
    }
    const unsynchronized = await db.whatsappTemplates.create({
      data: {
        vendorId: f.vendorId,
        templateName: 'missing_components',
        languageCode: 'en',
        status: 'APPROVED',
      },
    });
    const missing = await request(app)
      .post(f.path)
      .set('Authorization', f.auth)
      .send({ ...f.body, templateId: unsynchronized.id });
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe('RICH_TEMPLATE_MAPPING');
    expect(await db.campaigns.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('skips invalid dynamic button values individually without dropping valid recipients', async () => {
    const f = await richFixture('image', 2);
    await db.contacts.update({
      where: { id: f.contacts[0].id },
      data: { email: 'bad\u007fvalue' },
    });
    await db.contacts.update({
      where: { id: f.contacts[1].id },
      data: { email: 'valid@example.org' },
    });
    const id = await create(f, {
      ...f.options,
      buttonParameters: [{ index: 1, value: { contactField: 'email' } }],
    });
    await dispatchDueCampaigns(f.vendorId);
    const rows = await db.whatsappMessageQueue.findMany({
      where: { campaignId: id },
      orderBy: { id: 'asc' },
    });
    expect(rows[0]).toMatchObject({ status: 2, data: { skipped: 'TEMPLATE_VALUE_INVALID' } });
    expect(rows[1].status).toBe(3);
    expect(
      await db.outboxJobs.count({
        where: { vendorId: f.vendorId, payload: { path: ['campaignId'], equals: id } },
      }),
    ).toBe(1);
  });
  it('cancels prepared campaign sends after media, coupon or approved-template revisions change', async () => {
    for (const change of ['media', 'coupon', 'template']) {
      const f = await richFixture('image'),
        id = await create(f, f.options);
      await dispatchDueCampaigns(f.vendorId);
      const queued = await job(f.vendorId, id);
      if (change === 'template')
        await db.whatsappTemplates.update({
          where: { id: f.template.id },
          data: { updatedAt: new Date(Date.now() + 1000) },
        });
      else {
        const c = await db.campaigns.findUniqueOrThrow({ where: { id } }),
          data = c.data as any;
        await db.campaigns.update({
          where: { id },
          data: {
            data: {
              ...data,
              ...(change === 'media'
                ? { mediaHeader: { ...data.mediaHeader, url: 'https://cdn.whalexy.com/new.png' } }
                : { copyCode: 'NEW10' }),
            },
          },
        });
      }
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
    }
  });
  it('does not acknowledge a stale rich-template test after its media changes', async () => {
    const f = await richFixture('image'),
      id = await create(f, { ...f.options, requireTest: true });
    expect(
      (
        await request(app)
          .post(`${f.path}/${id}/test`)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'rich_changed_media')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(202);
    const test = await db.outboxJobs.findFirstOrThrow({
        where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
      }),
      c = await db.campaigns.findUniqueOrThrow({ where: { id } }),
      data = c.data as any;
    await db.campaigns.update({
      where: { id },
      data: {
        data: {
          ...data,
          mediaHeader: { ...data.mediaHeader, url: 'https://cdn.whalexy.com/revised.png' },
        },
      },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(test);
    await dispatchDueCampaigns(f.vendorId);
    expect(fetch).not.toHaveBeenCalled();
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_test');
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(0);
  });
  it('rolls back invalid rich-template preflight without an idempotency result or message', async () => {
    const f = await richFixture('image'),
      id = await create(f, {
        ...f.options,
        requireTest: true,
        buttonParameters: [{ index: 1, value: { contactField: 'email' } }],
      });
    await db.contacts.update({ where: { id: f.contacts[0].id }, data: { email: 'bad\nvalue' } });
    const result = await request(app)
      .post(`${f.path}/${id}/test`)
      .set('Authorization', f.auth)
      .set('Idempotency-Key', 'rich_invalid_value')
      .send({ contactId: f.contacts[0].id });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('TEMPLATE_VALUE_INVALID');
    expect(await db.nativeIdempotency.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.whatsappMessageLogs.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('preserves acknowledged historical text configurations across multiple audience batches', async () => {
    const f = await fixture(101),
      id = await create(f, { requireTest: true });
    const saved = await db.campaigns.findUniqueOrThrow({ where: { id } }),
      data = saved.data as any;
    delete data.buttonParameters;
    delete data.mediaHeader;
    delete data.copyCode;
    await db.campaigns.update({ where: { id }, data: { data } });
    expect(
      (
        await request(app)
          .post(`${f.path}/${id}/test`)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'historical_text_gate')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(202);
    const test = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ messages: [{ id: `wamid.old-text.${id}` }] })),
        ),
    );
    await processJob(test);
    await dispatchDueCampaigns(f.vendorId);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('dispatching');
    await dispatchDueCampaigns(f.vendorId);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('running');
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id, status: 3 } })).toBe(101);
  });
  it('requires an acknowledged test by default and keeps test sends outside audience reports', async () => {
    const f = await fixture(),
      id = await create(f, { requireTest: undefined });
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(0);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_test');
    const contact = await db.contacts.findUniqueOrThrow({ where: { id: f.contacts[0].id } });
    await db.vendorSettings.create({
      data: { vendorId: f.vendorId, name: 'test_recipient_contact', value: contact.uid },
    });
    const url = `${f.path}/${id}/test`,
      first = await request(app)
        .post(url)
        .set('Authorization', f.auth)
        .set('Idempotency-Key', 'preflight_same_key')
        .send({});
    expect(first.status).toBe(202);
    const repeated = await request(app)
      .post(url)
      .set('Authorization', f.auth)
      .set('Idempotency-Key', 'preflight_same_key')
      .send({});
    expect(repeated.body.id).toBe(first.body.id);
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'preflight_same_key')
          .send({ contactId: contact.id })
      ).status,
    ).toBe(409);
    const test = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.test.${id}` }] })),
        ),
    );
    await processJob(test);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('scheduled');
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(1);
    expect(
      (await request(app).get(`${f.path}/${id}/report`).set('Authorization', f.auth)).body,
    ).toMatchObject({ total: 1, delivered: 0 });
    const copy = await request(app)
      .post(`${f.path}/${id}/duplicate`)
      .set('Authorization', f.auth)
      .send({
        title: 'Fresh test needed',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(copy.status).toBe(201);
    expect(copy.body.status).toBe('awaiting_test');
    expect(
      (await db.campaigns.findUniqueOrThrow({ where: { id: copy.body.id } })).data,
    ).not.toHaveProperty('testReceipt');
  });
  it('requires permission to bypass testing and validates tenant and marketing test contacts', async () => {
    const f = await fixture(),
      foreign = await businessFixture();
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: {
        permissions: [
          'vendor.campaigns.create',
          'vendor.campaigns.send',
          'vendor.chats.reply',
          'vendor.chats.view_all',
        ],
      },
    });
    expect((await request(app).post(f.path).set('Authorization', f.auth).send(f.body)).status).toBe(
      403,
    );
    const id = await create(f, { requireTest: true });
    const other = await db.contacts.create({
      data: { vendorId: foreign.vendorId, waId: '919887776655' },
    });
    const url = `${f.path}/${id}/test`;
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'foreign_test_contact')
          .send({ contactId: other.id })
      ).status,
    ).toBe(400);
    await db.contacts.update({ where: { id: f.contacts[0].id }, data: { whatsappOptOut: 1 } });
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'opted_out_contact')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(409);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('invalidates an acknowledged test when the approved template changes before scheduling', async () => {
    const f = await fixture(),
      id = await create(f, { requireTest: true });
    expect(
      (
        await request(app)
          .post(`${f.path}/${id}/test`)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'approved_test_change')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(202);
    const test = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.revision.${id}` }] })),
        ),
    );
    await processJob(test);
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { updatedAt: new Date(Date.now() + 1000) },
    });
    await dispatchDueCampaigns(f.vendorId);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_test');
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(0);
  });
  it('records a test acknowledged during cancellation without releasing the audience', async () => {
    const f = await fixture(),
      id = await create(f, { requireTest: true });
    expect(
      (
        await request(app)
          .post(`${f.path}/${id}/test`)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'concurrent_test_cancel')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(202);
    const test = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        expect(
          (await request(app).post(`${f.path}/${id}/cancel`).set('Authorization', f.auth)).status,
        ).toBe(204);
        return new Response(JSON.stringify({ messages: [{ id: `wamid.cancelled-test.${id}` }] }));
      }),
    );
    await processJob(test);
    await dispatchDueCampaigns(f.vendorId);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('cancelled');
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (test.payload as any).messageId },
        })
      ).whatsappMessageId,
    ).toBe(`wamid.cancelled-test.${id}`);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(0);
  });
  it('does not release a cancelled campaign or dispatch a test after a template change', async () => {
    const f = await fixture(),
      id = await create(f, { requireTest: true });
    const sent = await request(app)
      .post(`${f.path}/${id}/test`)
      .set('Authorization', f.auth)
      .set('Idempotency-Key', 'stale_template_test')
      .send({ contactId: f.contacts[0].id });
    expect(sent.status).toBe(202);
    const test = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
    });
    await db.whatsappTemplates.update({
      where: { id: f.template.id },
      data: { updatedAt: new Date(Date.now() + 1000) },
    });
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    await processJob(test);
    expect(send).not.toHaveBeenCalled();
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_test');
    expect(
      (await request(app).post(`${f.path}/${id}/cancel`).set('Authorization', f.auth)).status,
    ).toBe(204);
    await processJob(test);
    await dispatchDueCampaigns(f.vendorId);
    expect(send).not.toHaveBeenCalled();
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('cancelled');
  });
  it('keeps an uncertain provider test blocked and does not retry it through another key', async () => {
    const f = await fixture(),
      id = await create(f, { requireTest: true });
    const url = `${f.path}/${id}/test`;
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'uncertain_test_key')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(202);
    const test = await db.outboxJobs.findFirstOrThrow({
      where: { vendorId: f.vendorId, payload: { path: ['campaignTestId'], equals: id } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] }))),
    );
    await expect(processJob(test)).rejects.toMatchObject({ code: 'PROVIDER_UNCERTAIN' });
    await db.outboxJobs.update({ where: { id: test.id }, data: { status: 'uncertain' } });
    expect(
      (
        await request(app)
          .post(url)
          .set('Authorization', f.auth)
          .set('Idempotency-Key', 'uncertain_second_key')
          .send({ contactId: f.contacts[0].id })
      ).status,
    ).toBe(409);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('awaiting_test');
  });
  it('snapshots all eligible business contacts without requiring group membership', async () => {
    const f = await fixture(3),
      foreign = await businessFixture();
    await db.groupContacts.deleteMany({ where: { groupId: f.group.id } });
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { whatsappOptOut: 1 } });
    await db.contacts.create({ data: { vendorId: foreign.vendorId, waId: '919888777665' } });
    const id = await create(f, { groupIds: [], allContacts: true });
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(2);
    expect((await job(f.vendorId, id)).payload).toHaveProperty('campaignId', id);
  });
  it('combines groups with explicit phones once and preserves opt-out and archived identities', async () => {
    const f = await fixture(3),
      existing = await db.contacts.findMany({
        where: { vendorId: f.vendorId },
        orderBy: { id: 'asc' },
      });
    await db.contacts.update({ where: { id: existing[1].id }, data: { whatsappOptOut: 1 } });
    await db.contacts.update({ where: { id: existing[2].id }, data: { status: 5 } });
    const unknown = `919${String(f.vendorId).padStart(8, '0')}`;
    const id = await create(f, { phoneNumbers: [...existing.map((c) => c.waId!), unknown] });
    await Promise.all([dispatchDueCampaigns(f.vendorId), dispatchDueCampaigns(f.vendorId)]);
    const queue = await db.whatsappMessageQueue.findMany({ where: { campaignId: id } });
    expect(queue.map((q) => q.phoneWithCountryCode).sort()).toEqual(
      [existing[0].waId!, unknown].sort(),
    );
    expect(
      await db.contacts.count({
        where: { vendorId: f.vendorId, waId: { in: [existing[1].waId!, existing[2].waId!] } },
      }),
    ).toBe(2);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId, waId: unknown } })).toBe(1);
  });
  it('supports phone-only audiences and rejects empty or ambiguous selectors', async () => {
    const f = await fixture(),
      unknown = `918${String(f.vendorId).padStart(8, '0')}`;
    for (const extra of [
      { groupIds: [] },
      { allContacts: true },
      { groupIds: [], phoneNumbers: ['invalid'] },
      { groupIds: [], phoneNumbers: [unknown, unknown] },
    ])
      expect(
        (
          await request(app)
            .post(f.path)
            .set('Authorization', f.auth)
            .send({ ...f.body, ...extra })
        ).status,
      ).toBe(400);
    const id = await create(f, { groupIds: [], phoneNumbers: [unknown] });
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(1);
    const copied = await request(app)
      .post(`${f.path}/${id}/duplicate`)
      .set('Authorization', f.auth)
      .send({ title: 'Phones again', scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    expect(copied.status).toBe(201);
    expect(
      (await db.campaigns.findUniqueOrThrow({ where: { id: copied.body.id } })).data,
    ).toMatchObject({ groupIds: [], phoneNumbers: [unknown], allContacts: false });
  });
  it('archives only stopped campaigns and restores status without restarting sends', async () => {
    const f = await fixture(),
      id = await create(f);
    expect(
      (await request(app).post(`${f.path}/${id}/archive`).set('Authorization', f.auth)).status,
    ).toBe(409);
    await dispatchDueCampaigns(f.vendorId);
    const queued = await job(f.vendorId, id);
    expect(
      (await request(app).post(`${f.path}/${id}/cancel`).set('Authorization', f.auth)).status,
    ).toBe(204);
    expect(
      (await request(app).post(`${f.path}/${id}/archive`).set('Authorization', f.auth)).status,
    ).toBe(204);
    expect((await request(app).get(f.path).set('Authorization', f.auth)).body).toHaveLength(0);
    expect(
      (await request(app).get(`${f.path}?archived=true`).set('Authorization', f.auth)).body,
    ).toHaveLength(1);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(queued);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await request(app).post(`${f.path}/${id}/unarchive`).set('Authorization', f.auth)).status,
    ).toBe(204);
    await dispatchDueCampaigns(f.vendorId);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('cancelled');
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('reports cumulative delivery, distinct recipient failures and uncertainty without zero division', async () => {
    const f = await fixture(4),
      id = await create(f);
    let report = await request(app).get(`${f.path}/${id}/report`).set('Authorization', f.auth);
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({ total: 0, deliveredPercent: 0, failedPercent: 0 });
    await dispatchDueCampaigns(f.vendorId);
    const logs = await db.whatsappMessageLogs.findMany({
      where: { campaignId: id },
      orderBy: { contactId: 'asc' },
    });
    await db.whatsappMessageLogs.update({ where: { id: logs[0].id }, data: { status: 'read' } });
    await db.whatsappMessageLogs.update({
      where: { id: logs[1].id },
      data: { status: 'delivered' },
    });
    await db.whatsappMessageLogs.update({ where: { id: logs[2].id }, data: { status: 'failed' } });
    await db.whatsappMessageQueue.updateMany({
      where: { campaignId: id, contactId: logs[2].contactId },
      data: { status: 2 },
    });
    await db.whatsappMessageLogs.update({
      where: { id: logs[3].id },
      data: { status: 'uncertain' },
    });
    await db.whatsappMessageQueue.updateMany({
      where: { campaignId: id, contactId: logs[3].contactId },
      data: { status: 2 },
    });
    report = await request(app).get(`${f.path}/${id}/report`).set('Authorization', f.auth);
    expect(report.body).toMatchObject({
      total: 4,
      delivered: 2,
      read: 1,
      failed: 1,
      uncertain: 1,
      deliveredPercent: 50,
      readPercent: 25,
      failedPercent: 25,
    });
  });
  it('protects reports and recipient identifiers with tenant and phone permissions', async () => {
    const f = await fixture(),
      foreign = await businessFixture(),
      id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    expect(
      (
        await request(app)
          .get(`${f.path}/${id}/report`)
          .set('Authorization', `Bearer ${foreign.token}`)
      ).status,
    ).toBe(403);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: foreign.userId,
        role: 'agent',
        permissions: ['vendor.campaigns.view', 'vendor.chats.view_all'],
      },
    });
    const response = await request(app)
      .get(`${f.path}/${id}/recipients`)
      .set('Authorization', `Bearer ${foreign.token}`);
    expect(response.status).toBe(200);
    expect(response.body.items[0].phoneWithCountryCode).toMatch(/^\*\*\*\d{4}$/);
    expect(response.body.items[0]).not.toHaveProperty('data');
    expect(
      (await request(app).get(`${f.path}/${id}/recipients?limit=101`).set('Authorization', f.auth))
        .status,
    ).toBe(400);
  });
  it('excludes opted-out, foreign-number, social and wrong-language recipients', async () => {
    const f = await fixture(5);
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { whatsappOptOut: 1 } });
    await db.contacts.update({
      where: { id: f.contacts[2].id },
      data: { wabPhoneNumberId: 'another-number' },
    });
    await db.contacts.update({ where: { id: f.contacts[3].id }, data: { platform: 'instagram' } });
    await db.contacts.update({ where: { id: f.contacts[4].id }, data: { languageCode: 'hi' } });
    const id = await create(f, { restrictLanguage: true });
    await dispatchDueCampaigns(f.vendorId);
    const queue = await db.whatsappMessageQueue.findMany({ where: { campaignId: id } });
    expect(queue).toHaveLength(1);
    expect(queue[0].contactId).toBe(f.contacts[0].id);
  });
  it('renders per-contact fields and custom values and rejects foreign field definitions', async () => {
    const f = await fixture(1, true),
      foreign = await businessFixture();
    const field = await db.contactCustomFields.create({
      data: { vendorId: f.vendorId, inputName: 'reference', inputType: 'text' },
    });
    const badField = await db.contactCustomFields.create({
      data: { vendorId: foreign.vendorId, inputName: 'foreign', inputType: 'text' },
    });
    await db.contactCustomFieldValues.create({
      data: { contactId: f.contacts[0].id, contactCustomFieldsId: field.id, fieldValue: 'REF-123' },
    });
    const values = [{ contactField: 'firstName' }, { customFieldId: field.id }];
    expect(
      (
        await request(app)
          .post(f.path)
          .set('Authorization', f.auth)
          .send({ ...f.body, bodyParameters: [values[0], { customFieldId: badField.id }] })
      ).status,
    ).toBe(400);
    expect((await request(app).post(f.path).set('Authorization', f.auth).send(f.body)).status).toBe(
      409,
    );
    const id = await create(f, { bodyParameters: values });
    await dispatchDueCampaigns(f.vendorId);
    expect((await job(f.vendorId, id)).payload).toMatchObject({
      payload: {
        template: {
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Person 0' },
                { type: 'text', text: 'REF-123' },
              ],
            },
          ],
        },
      },
    });
  });
  it('snapshots more than 1000 contacts and resumes bounded batches without duplicates', async () => {
    const f = await fixture(1001),
      id = await create(f);
    await Promise.all([dispatchDueCampaigns(f.vendorId), dispatchDueCampaigns(f.vendorId)]);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(1001);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(200);
    await db.groupContacts.deleteMany({ where: { groupId: f.group.id } });
    for (let i = 0; i < 9; i++) await dispatchDueCampaigns(f.vendorId);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1001);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('running');
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1001);
  }, 60000);
  it('rechecks opt-out after queuing and makes no provider call', async () => {
    const f = await fixture(),
      id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    const consent = await request(app)
      .post(`/api/v1/vendors/${f.vendorId}/contacts/${f.contacts[0].id}/marketing-consent`)
      .set('Authorization', f.auth)
      .send({ optedOut: true });
    expect(consent.status).toBe(204);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(await job(f.vendorId, id));
    expect(fetch).not.toHaveBeenCalled();
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe(
      'completed_with_errors',
    );
  });
  it('pauses queued provider effects and resumes the original lifecycle', async () => {
    const f = await fixture(),
      id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    const queued = await job(f.vendorId, id);
    expect(
      (await request(app).post(`${f.path}/${id}/pause`).set('Authorization', f.auth)).status,
    ).toBe(204);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: `wamid.campaign.${id}` }] })),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(processJob(queued)).rejects.toMatchObject({ code: 'CAMPAIGN_PAUSED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (await request(app).post(`${f.path}/${id}/resume`).set('Authorization', f.auth)).status,
    ).toBe(204);
    await processJob(queued);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('completed');
  });
  it('cancels prepared jobs and unsent audience rows without dispatching', async () => {
    const f = await fixture(101),
      id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    const queued = await job(f.vendorId, id);
    expect(
      (await request(app).post(`${f.path}/${id}/cancel`).set('Authorization', f.auth)).status,
    ).toBe(204);
    await dispatchDueCampaigns(f.vendorId);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(queued);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await db.whatsappMessageQueue.count({ where: { campaignId: id, status: { in: [1, 3] } } }),
    ).toBe(0);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId, status: 'pending' } })).toBe(
      0,
    );
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('cancelled');
  });
  it('duplicates configuration into a fresh campaign without copying execution state', async () => {
    const f = await fixture(),
      id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    const response = await request(app)
      .post(`${f.path}/${id}/duplicate`)
      .set('Authorization', f.auth)
      .send({ title: 'Copy', scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    expect(response.status).toBe(201);
    const copy = await db.campaigns.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(copy.status).toBe('scheduled');
    expect(copy.data).not.toHaveProperty('audienceInitialized');
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: copy.id } })).toBe(0);
  });
  it('enforces tenant boundaries and rejects groups tied to another connected number', async () => {
    const f = await fixture(),
      foreign = await businessFixture();
    expect(
      (await request(app).post(f.path).set('Authorization', `Bearer ${foreign.token}`).send(f.body))
        .status,
    ).toBe(403);
    await db.contactGroups.update({
      where: { id: f.group.id },
      data: { wabPhoneNumberId: 'foreign-scope' },
    });
    expect((await request(app).post(f.path).set('Authorization', f.auth).send(f.body)).status).toBe(
      409,
    );
  });
  it('skips an invalid per-contact value without blocking other recipients', async () => {
    const f = await fixture(2, true);
    await db.contacts.update({
      where: { id: f.contacts[0].id },
      data: { firstName: 'Invalid\nname' },
    });
    const id = await create(f, {
      bodyParameters: [{ contactField: 'firstName' }, { literal: 'Reference' }],
    });
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id, status: 2 } })).toBe(1);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('running');
  });
  it('completes after concurrent provider acknowledgements without leaving a running campaign', async () => {
    const f = await fixture(2),
      id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    const jobs = await db.outboxJobs.findMany({ where: { vendorId: f.vendorId } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async (_url: string, init: RequestInit) =>
          new Response(
            JSON.stringify({
              messages: [{ id: `wamid.concurrent.${JSON.parse(init.body as string).to}` }],
            }),
          ),
      ),
    );
    await Promise.all(jobs.map((queued) => processJob(queued)));
    expect((await db.campaigns.findUniqueOrThrow({ where: { id } })).status).toBe('completed');
  });
  it('deduplicates recipient identities and cannot bypass opt-out through duplicate contacts', async () => {
    const f = await fixture(2),
      first = await db.contacts.findUniqueOrThrow({ where: { id: f.contacts[0].id } });
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { waId: first.waId } });
    const id = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: id } })).toBe(1);
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { whatsappOptOut: 1 } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(await job(f.vendorId, id));
    expect(fetch).not.toHaveBeenCalled();
    const second = await create(f);
    await dispatchDueCampaigns(f.vendorId);
    expect(await db.whatsappMessageQueue.count({ where: { campaignId: second } })).toBe(0);
  });
});
