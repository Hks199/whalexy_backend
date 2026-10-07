import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt, digest } from '../src/utils/crypto.js';
import { config } from '../src/config/environment.js';
import { sheetScript } from '../src/modules/sheets/services/sheet-script.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture(
  category = 'UTILITY',
  components: any[] = [{ type: 'BODY', text: 'Hello {{1}}' }],
) {
  const f = await businessFixture(),
    phone = `8899${f.vendorId}`,
    prefix = `/api/v1/vendors/${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('sheet-provider-test'),
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
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: f.vendorId,
      templateName: `sheet_${f.vendorId}`,
      languageCode: 'en',
      status: 'APPROVED',
      category,
      data: { components },
    },
  });
  const settings = {
    title: 'Native sheet',
    spreadsheetId: 'a'.repeat(30),
    sheetName: 'Orders',
    phoneNumberId: phone,
    triggerType: 'new_row',
    phoneColumn: 0,
    rowIdColumn: 3,
    statusColumn: 4,
    rules: [{ templateId: template.id, bodyColumns: [1] }],
  };
  return { ...f, phone, prefix, contact, template, settings, auth: `Bearer ${f.token}` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture, settings: any = f.settings) =>
  request(app).post(`${f.prefix}/sheets`).set('Authorization', f.auth).send(settings);
const submit = (f: Fixture, uid: string, rowId = randomUUID(), row = [f.contact.waId!, 'Alice']) =>
  request(app)
    .post(`${f.prefix}/sheets/${uid}/rows`)
    .set('Authorization', f.auth)
    .send({ rowId, row });
const jobs = (f: Fixture) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });
describe('native Google Sheets automation', () => {
  it('creates an owned configuration, lists template requirements and serializes duplicate row delivery', async () => {
    const f = await fixture(),
      created = await create(f);
    expect(created.status).toBe(201);
    const uid = created.body.uid,
      rowId = randomUUID();
    const results = await Promise.all([submit(f, uid, rowId), submit(f, uid, rowId)]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
    expect(results[0].body).toEqual(results[1].body);
    expect(await jobs(f)).toHaveLength(1);
    expect(
      (await request(app).get(`${f.prefix}/sheets/templates`).set('Authorization', f.auth)).body
        .items[0].schema.body,
    ).toBe(1);
    expect(
      (await request(app).get(`${f.prefix}/sheets`).set('Authorization', f.auth)).body.total,
    ).toBe(1);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ messages: [{ id: `wamid.sheet.${randomUUID()}` }] })),
      ),
    );
    await processJob((await jobs(f))[0]);
    await processJob((await jobs(f))[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('matches column values case-insensitively and keeps separate rules for one template distinct', async () => {
    const f = await fixture(),
      created = await create(f, {
        ...f.settings,
        triggerType: 'column_value',
        triggerColumn: 2,
        rules: [
          { templateId: f.template.id, triggerValue: 'Paid', bodyColumns: [1] },
          { templateId: f.template.id, triggerValue: 'Ready', bodyColumns: [1] },
        ],
      }),
      uid = created.body.uid,
      rowId = randomUUID();
    expect(created.status).toBe(201);
    expect((await submit(f, uid, rowId, [f.contact.waId!, 'Alice', '  PAID  '])).status).toBe(202);
    expect((await submit(f, uid, rowId, [f.contact.waId!, 'Alice', 'Ready'])).status).toBe(202);
    expect(await jobs(f)).toHaveLength(2);
    expect((await submit(f, uid, randomUUID(), ['invalid', 'Alice', 'other'])).body.items).toEqual(
      [],
    );
  });
  it('rejects row changes under an existing identity without duplicating the queued effect', async () => {
    const f = await fixture(),
      created = await create(f),
      id = randomUUID();
    expect((await submit(f, created.body.uid, id)).status).toBe(202);
    const changed = await submit(f, created.body.uid, id, [f.contact.waId!, 'Bob']);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await jobs(f)).toHaveLength(1);
  });
  it('maps document headers, dynamic URL buttons and coupon codes from validated row values', async () => {
    const f = await fixture('MARKETING', [
      { type: 'HEADER', format: 'DOCUMENT' },
      { type: 'BODY', text: 'Hello {{1}}' },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'URL', url: 'https://shop.example.com/{{1}}' }, { type: 'COPY_CODE' }],
      },
    ]);
    const created = await create(f, {
      ...f.settings,
      rowIdColumn: 7,
      statusColumn: 8,
      rules: [
        {
          templateId: f.template.id,
          bodyColumns: [1],
          mediaColumn: 2,
          filenameColumn: 3,
          buttonColumns: { '0': 4 },
          copyCodeColumn: 5,
        },
      ],
    });
    expect(created.status).toBe(201);
    expect(
      (
        await submit(f, created.body.uid, randomUUID(), [
          f.contact.waId!,
          'Alice',
          'https://cdn.example.com/invoice.pdf',
          'Invoice.pdf',
          'order-1',
          'SAVE10',
        ])
      ).status,
    ).toBe(202);
    expect((await jobs(f))[0].payload).toMatchObject({
      payload: {
        template: {
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'document',
                  document: {
                    link: 'https://cdn.example.com/invoice.pdf',
                    filename: 'Invoice.pdf',
                  },
                },
              ],
            },
            { type: 'body', parameters: [{ type: 'text', text: 'Alice' }] },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: 'order-1' }],
            },
            {
              type: 'button',
              sub_type: 'copy_code',
              index: '1',
              parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }],
            },
          ],
        },
      },
    });
    expect(
      (
        await submit(f, created.body.uid, randomUUID(), [
          f.contact.waId!,
          'Alice',
          'http://127.0.0.1/file',
          '../Invoice.pdf',
          'order',
          'SAVE',
        ])
      ).status,
    ).toBe(400);
  });
  it('rejects ambiguous or foreign contacts and marketing opt-outs without queuing', async () => {
    const f = await fixture('MARKETING'),
      created = await create(f);
    await db.contacts.update({ where: { id: f.contact.id }, data: { whatsappOptOut: 1 } });
    expect((await submit(f, created.body.uid)).body.error.code).toBe('MARKETING_OPT_OUT');
    await db.contacts.update({ where: { id: f.contact.id }, data: { whatsappOptOut: null } });
    await db.contacts.create({
      data: {
        vendorId: f.vendorId,
        waId: f.contact.waId,
        platform: 'whatsapp',
        wabPhoneNumberId: f.phone,
      },
    });
    expect((await submit(f, created.body.uid)).body.error.code).toBe('SHEET_CONTACT_UNRESOLVED');
    expect(
      (await submit(f, created.body.uid, randomUUID(), ['919999999999', 'Alice'])).status,
    ).toBe(409);
    expect(await jobs(f)).toHaveLength(0);
  });
  it('validates column collisions, required mappings, rule uniqueness and approved ownership', async () => {
    const f = await fixture(),
      other = await fixture();
    for (const settings of [
      { ...f.settings, rowIdColumn: 0 },
      { ...f.settings, rowIdColumn: 1 },
      { ...f.settings, statusColumn: 1 },
      { ...f.settings, rules: [{ templateId: f.template.id }] },
      { ...f.settings, rules: [{ templateId: other.template.id, bodyColumns: [1] }] },
      {
        ...f.settings,
        triggerType: 'column_value',
        triggerColumn: 2,
        rules: [
          { templateId: f.template.id, bodyColumns: [1], triggerValue: 'Paid' },
          { templateId: f.template.id, bodyColumns: [1], triggerValue: ' paid ' },
        ],
      },
    ])
      expect((await create(f, settings)).status).toBe(400);
    expect(await db.googleSheetAutomations.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it.each(['disabled', 'deleted', 'template', 'opt-out'])(
    'cancels queued sends after %s changes',
    async (change) => {
      const f = await fixture('MARKETING'),
        created = await create(f);
      expect((await submit(f, created.body.uid)).status).toBe(202);
      if (change === 'disabled')
        expect(
          (
            await request(app)
              .patch(`${f.prefix}/sheets/${created.body.uid}/status`)
              .set('Authorization', f.auth)
              .send({ enabled: false })
          ).status,
        ).toBe(200);
      if (change === 'deleted')
        expect(
          (
            await request(app)
              .delete(`${f.prefix}/sheets/${created.body.uid}`)
              .set('Authorization', f.auth)
          ).status,
        ).toBe(204);
      if (change === 'template')
        await db.whatsappTemplates.update({
          where: { id: f.template.id },
          data: { updatedAt: new Date(Date.now() + 1000) },
        });
      if (change === 'opt-out')
        await db.contacts.update({ where: { id: f.contact.id }, data: { whatsappOptOut: 1 } });
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
    },
  );
  it('enforces scoped API permissions and revocation again before provider dispatch', async () => {
    const f = await fixture(),
      created = await create(f),
      secret = randomUUID();
    const key = await db.apiKeys.create({
      data: {
        vendorId: f.vendorId,
        userId: f.userId,
        keyHash: digest(secret),
        permissions: ['vendor.integrations.manage', 'vendor.chats.reply', 'vendor.chats.view_all'],
      },
    });
    const row = await request(app)
      .post(`${f.prefix}/sheets/${created.body.uid}/rows`)
      .set('Authorization', `ApiKey ${secret}`)
      .send({ rowId: randomUUID(), row: [f.contact.waId, 'Alice'] });
    expect(row.status).toBe(202);
    expect(
      (
        await request(app)
          .post(`${f.prefix}/sheets`)
          .set('Authorization', `ApiKey ${secret}`)
          .send(f.settings)
      ).status,
    ).toBe(403);
    await db.apiKeys.update({
      where: { id: key.id },
      data: { permissions: ['vendor.chats.reply', 'vendor.chats.view_all'] },
    });
    vi.stubGlobal('fetch', vi.fn());
    await expect(processJob((await jobs(f))[0])).rejects.toMatchObject({
      code: 'SENDER_ACCESS_REVOKED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not reveal legacy script credentials and blocks generic writes or legacy execution', async () => {
    const f = await fixture(),
      legacy = await db.googleSheetAutomations.create({
        data: {
          vendorId: f.vendorId,
          title: 'Legacy',
          config: { apiToken: 'private-old-secret' },
          generatedScript: 'const token = "private-old-secret";',
        },
      });
    const get = await request(app)
      .get(`${f.prefix}/sheets/${legacy.uid}`)
      .set('Authorization', f.auth);
    expect(get.body.config).toBeNull();
    expect(JSON.stringify(get.body)).not.toContain('private-old-secret');
    expect((await submit(f, legacy.uid)).body.error.code).toBe('LEGACY_SHEET_CONFIGURATION');
    const list = await request(app)
      .get(`${f.prefix}/resources/sheet-automations`)
      .set('Authorization', f.auth);
    expect(JSON.stringify(list.body)).not.toContain('private-old-secret');
    expect(
      (
        await request(app)
          .post(`${f.prefix}/resources/sheet-automations`)
          .set('Authorization', f.auth)
          .send({ title: 'Bypass' })
      ).status,
    ).toBe(403);
  });
  it('isolates foreign automation routes and denies agents without integration permission', async () => {
    const f = await fixture(),
      other = await fixture(),
      created = await create(other);
    expect((await submit(f, created.body.uid)).status).toBe(404);
    const agent = await businessFixture(['vendor.chats.reply']);
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${agent.vendorId}/sheets`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status,
    ).toBe(403);
  });
  it('downloads executable credential-free source only for a configured HTTPS public URL', async () => {
    const f = await fixture(),
      created = await create(f),
      previous = config.PUBLIC_URL;
    try {
      config.PUBLIC_URL = 'https://app.whalexy.test';
      const script = await request(app)
        .get(`${f.prefix}/sheets/${created.body.uid}/script`)
        .set('Authorization', f.auth);
      expect(script.status).toBe(200);
      expect(script.text).toContain(`vendors/${f.vendorId}/sheets/${created.body.uid}/rows`);
      expect(script.text).toContain('WHALEXY_API_KEY');
      expect(() => new vm.Script(script.text)).not.toThrow();
      config.PUBLIC_URL = 'http://app.whalexy.test';
      expect(
        (
          await request(app)
            .get(`${f.prefix}/sheets/${created.body.uid}/script`)
            .set('Authorization', f.auth)
        ).status,
      ).toBe(503);
    } finally {
      config.PUBLIC_URL = previous;
    }
  });
});
describe('generated Apps Script retries', () => {
  it('preserves row UUID and cursor after a lost response and advances only after durable queue acknowledgement', () => {
    const settings = {
        uid: randomUUID(),
        apiUrl: 'https://app.example.com/rows',
        spreadsheetId: 'testspreadsheet',
        sheetName: 'Orders',
        triggerType: 'new_row',
        phoneColumn: 0,
        rowIdColumn: 2,
      },
      properties = new Map([['WHALEXY_API_KEY', 'scoped-private-test-key']]),
      row = ['919999999999', 'Alice', ''],
      requests: any[] = [];
    let fail = true,
      releases = 0;
    const sheet: any = {
      getLastRow: () => 2,
      getLastColumn: () => 3,
      getRange: (_r: number, c: number) => ({
        getDisplayValues: () => [[...row]],
        setValue: (v: string) => {
          row[c - 1] = v;
        },
        setNote: () => {},
      }),
    };
    const context = vm.createContext({
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) => properties.get(k),
          setProperty: (k: string, v: string) => properties.set(k, v),
        }),
      },
      SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush: () => {} },
      Utilities: { getUuid: () => randomUUID() },
      LockService: {
        getScriptLock: () => ({
          waitLock: () => {},
          releaseLock: () => {
            releases++;
          },
        }),
      },
      UrlFetchApp: {
        fetch: (_url: string, options: any) => {
          requests.push(options);
          if (fail) throw new Error('Lost network response');
          return {
            getResponseCode: () => 202,
            getContentText: () => JSON.stringify({ items: [{ id: 1, status: 'queued' }] }),
          };
        },
      },
    });
    vm.runInContext(sheetScript(settings), context);
    expect(() => vm.runInContext('checkForNewRows()', context)).toThrow('Lost network response');
    const uuid = row[2];
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(properties.get('whalexyCursor:' + settings.uid)).toBeUndefined();
    fail = false;
    vm.runInContext('checkForNewRows()', context);
    expect(row[2]).toBe(uuid);
    expect(JSON.parse(requests[0].payload).rowId).toBe(JSON.parse(requests[1].payload).rowId);
    expect(properties.get('whalexyCursor:' + settings.uid)).toBe('2');
    expect(releases).toBe(2);
    expect(requests[0].followRedirects).toBe(false);
    expect(requests[0].headers.Authorization).toBe('ApiKey scoped-private-test-key');
  });
});
