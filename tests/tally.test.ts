import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
afterEach(() => vi.unstubAllGlobals());
async function fixture(document = false) {
  const f = await businessFixture(),
    phone = `8877${f.vendorId}`,
    prefix = `/api/v1/vendors/${f.vendorId}/tally`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('tally-test-token'),
    },
  });
  const contact = await db.contacts.create({
      data: {
        vendorId: f.vendorId,
        waId: `9195${String(f.vendorId).padStart(7, '0')}`,
        firstName: 'Alice',
        wabPhoneNumberId: phone,
        platform: 'whatsapp',
      },
    }),
    template = await db.whatsappTemplates.create({
      data: {
        vendorId: f.vendorId,
        templateName: `invoice_${f.vendorId}`,
        languageCode: 'en',
        status: 'APPROVED',
        category: 'UTILITY',
        data: {
          components: [
            ...(document ? [{ type: 'HEADER', format: 'DOCUMENT' }] : []),
            { type: 'BODY', text: '{{1}} {{2}} {{3}} {{4}}' },
          ],
        },
      },
    });
  return {
    ...f,
    prefix,
    phone,
    contact,
    template,
    auth: `Bearer ${f.token}`,
    body: {
      sourceId: 'ledger_invoice_1',
      contactId: contact.id,
      phoneNumberId: phone,
      templateId: template.id,
      invoiceNumber: 'INV_001',
      invoiceAmount: '1200.50',
      currency: 'INR',
      invoiceDate: '2026-10-03',
      ...(document ? { pdfUrl: 'https://cdn.example.com/invoice.pdf' } : {}),
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const send = (f: Fixture, body: any = f.body) =>
  request(app).post(`${f.prefix}/invoices`).set('Authorization', f.auth).send(body);
const jobs = (f: Fixture) =>
  db.outboxJobs.findMany({ where: { vendorId: f.vendorId, kind: 'whatsapp-send' } });
describe('native Tally invoice delivery', () => {
  it('maps original Tally aliases and UUID routing while deduplicating invoice delivery', async () => {
    const f = await fixture();
    await db.manualSubscriptions.create({ data: { vendorId: f.vendorId, status: 'active' } });
    const vendor = await db.vendors.findUniqueOrThrow({ where: { id: f.vendorId } });
    const prefix = `/api/${vendor.uid}/tally`;
    const body = {
      customer_mobile: f.contact.waId,
      party_name: 'Alice',
      voucher_number: 'INV_001',
      amount: '1200.50',
      date: '03-10-2026',
      template_name: f.template.templateName,
      template_language: 'en',
      from_phone_number_id: f.phone,
    };
    const sendLegacy = (payload = body) =>
      request(app).post(`${prefix}/send-invoice`).set('Authorization', f.auth).send(payload);
    const results = await Promise.all([sendLegacy(), sendLegacy()]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
    expect(results[0].body).toMatchObject({
      result: 'success',
      invoice_number: 'INV_001',
      recipient: f.contact.waId,
      template_used: f.template.templateName,
    });
    expect(await jobs(f)).toHaveLength(1);
    expect((await sendLegacy({ ...body, amount: '99.00' })).status).toBe(409);
    expect(
      (await request(app).get(`${prefix}/ping`).set('Authorization', f.auth)).body.vendor.uid,
    ).toBe(vendor.uid);
    const other = await fixture();
    expect((await request(app).get(`${prefix}/ping`).set('Authorization', other.auth)).status).toBe(
      403,
    );
    expect((await sendLegacy({ ...body, date: '30-02-2026' })).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`${prefix}/send-invoice`)
          .set('Authorization', f.auth)
          .send({ ...body, phone_number: f.contact.waId })
      ).status,
    ).toBe(400);
    await db.manualSubscriptions.deleteMany({ where: { vendorId: f.vendorId } });
    expect((await sendLegacy()).status).toBe(403);
    expect(await jobs(f)).toHaveLength(1);
  });
  it('queues once under concurrent retries, renders source invoice fields and reports actual delivery status', async () => {
    const f = await fixture(),
      responses = await Promise.all([send(f), send(f)]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(await jobs(f)).toHaveLength(1);
    expect((await jobs(f))[0].payload).toMatchObject({
      payload: {
        template: {
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Alice' },
                { type: 'text', text: 'INV_001' },
                { type: 'text', text: 'Invoice #INV_001' },
                { type: 'text', text: '1200.50' },
              ],
            },
          ],
        },
      },
    });
    expect(
      (await request(app).get(`${f.prefix}/ping`).set('Authorization', f.auth)).body.result,
    ).toBe('success');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ messages: [{ id: `wamid.tally.${randomUUID()}` }] })),
      ),
    );
    await processJob((await jobs(f))[0]);
    const status = await request(app)
      .get(`${f.prefix}/invoices/${f.body.sourceId}`)
      .set('Authorization', f.auth);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('sent');
    expect(status.body.invoiceAmount).toBe('1200.50');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses an owned approved document template and guards public PDF URLs', async () => {
    const f = await fixture(true);
    expect((await send(f)).status).toBe(202);
    expect((await jobs(f))[0].payload).toMatchObject({
      payload: {
        template: {
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'document',
                  document: { link: f.body.pdfUrl, filename: 'Invoice_INV_001.pdf' },
                },
              ],
            },
            {},
          ],
        },
      },
    });
    expect(
      (await send(f, { ...f.body, sourceId: 'missing_pdf', pdfUrl: undefined })).body.error.code,
    ).toBe('TALLY_DOCUMENT_REQUIRED');
    expect((await send(f, { ...f.body, pdfUrl: 'https://127.0.0.1/invoice.pdf' })).status).toBe(
      400,
    );
  });
  it('blocks changed invoice values under the same source identity without another effect', async () => {
    const f = await fixture();
    expect((await send(f)).status).toBe(202);
    expect((await send(f, { ...f.body, invoiceAmount: '99.00' })).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await jobs(f)).toHaveLength(1);
  });
  it('rejects invalid dates, currencies, amounts and mismatched template parameter mapping', async () => {
    const f = await fixture();
    for (const body of [
      { ...f.body, invoiceDate: '2026-02-30' },
      { ...f.body, currency: 'ZZZ' },
      { ...f.body, invoiceAmount: '1,200' },
      { ...f.body, bodyFields: ['invoiceNumber'] },
      { ...f.body, pdfUrl: 'https://cdn.example.com/unrequested.pdf' },
    ])
      expect((await send(f, body)).status).toBe(400);
    expect(await jobs(f)).toHaveLength(0);
  });
  it('isolates foreign contacts, templates, phone scopes and invoice history', async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await send(f, { ...f.body, contactId: other.contact.id })).status).toBe(404);
    expect((await send(f, { ...f.body, templateId: other.template.id })).status).toBe(400);
    expect((await send(f, { ...f.body, phoneNumberId: other.phone })).status).toBe(409);
    expect(
      (
        await request(app)
          .get(`${other.prefix}/invoices/${f.body.sourceId}`)
          .set('Authorization', other.auth)
      ).status,
    ).toBe(404);
    expect(await jobs(f)).toHaveLength(0);
  });
  it.each(['template', 'opt-out', 'disconnect'])(
    'does not dispatch after %s changes',
    async (change) => {
      const f = await fixture();
      await db.whatsappTemplates.update({
        where: { id: f.template.id },
        data: { category: 'MARKETING' },
      });
      expect((await send(f)).status).toBe(202);
      if (change === 'template')
        await db.whatsappTemplates.update({
          where: { id: f.template.id },
          data: { status: 'PAUSED', updatedAt: new Date() },
        });
      if (change === 'opt-out')
        await db.contacts.update({ where: { id: f.contact.id }, data: { whatsappOptOut: 1 } });
      if (change === 'disconnect')
        await db.integrationCredentials.deleteMany({
          where: { vendorId: f.vendorId, provider: 'whatsapp' },
        });
      vi.stubGlobal('fetch', vi.fn());
      if (change === 'disconnect')
        await expect(processJob((await jobs(f))[0])).rejects.toMatchObject({
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      else await processJob((await jobs(f))[0]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
