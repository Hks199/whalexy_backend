import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  prefix = '/vendor-console/whatsapp-orders',
  ids: number[] = [],
  payments: string[] = [],
  actors: { vendorId: number; userId: number }[] = [],
  receipts: string[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.whatsappPayments.deleteMany({ where: { paymentId: { in: payments } } });
  await db.whatsappOrders.deleteMany({ where: { id: { in: ids } } });
  await db.configurations.deleteMany({
    where: {
      OR: actors.map((a) => ({
        name: { startsWith: `legacy-order-status:${a.vendorId}:${a.userId}:` },
      })),
    },
  });
  await db.webhookReceipts.deleteMany({ where: { eventKey: { in: receipts } } });
  await db.$disconnect();
});
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  actors.push({ vendorId: f.vendorId, userId: f.userId });
  const get = (suffix = '', query = {}) =>
    request(app)
      .get(prefix + suffix)
      .set('Authorization', `Bearer ${f.token}`)
      .set('X-Vendor-Id', String(f.vendorId))
      .query(query);
  const order = async (extra: any = {}) => {
    const row = await db.whatsappOrders.create({
      data: {
        vendorId: f.vendorId,
        orderId: `ORD-${randomUUID()}`,
        customerPhone: '919876543210',
        customerName: 'Order customer',
        items: [
          {
            product_retailer_id: 'sku-1',
            quantity: 2,
            item_price: '5.25',
            currency: 'INR',
            secret: 'private item',
          },
        ],
        totalAmount: '20.1250',
        taxAmount: '2',
        shippingAmount: '3',
        discountAmount: '1.1250',
        deliveryAddress: 'Private address',
        data: { secret: 'private order' },
        ...extra,
      },
    });
    ids.push(row.id);
    return row;
  };
  const payment = async (orderId: string, extra: any = {}) => {
    const paymentId = extra.paymentId ?? randomUUID();
    payments.push(paymentId);
    return db.whatsappPayments.create({
      data: {
        vendorId: f.vendorId,
        paymentId,
        orderId,
        amount: '19',
        gatewayResponse: { secret: 'private gateway' },
        paymentLinkUrl: 'https://private.example/link',
        transactionId: 'private reference',
        ...extra,
      },
    });
  };
  return { ...f, get, order, payment };
}
describe('original WhatsApp order reads', () => {
  it('projects source fields and exact money without order, item or provider secrets', async () => {
    const f = await fixture(),
      row = await f.order();
    await f.payment(row.orderId, { status: 'completed' });
    const list = await f.get('/data');
    expect(list.status).toBe(200);
    const projected = list.body.data.orders.data.find((r: any) => r._uid === row.uid);
    expect(projected).toMatchObject({
      order_id: row.orderId,
      final_amount: '19',
      customer_phone: row.customerPhone,
    });
    expect(projected.items[0]).not.toHaveProperty('secret');
    expect(projected).not.toHaveProperty('__data');
    const detail = await f.get('/' + row.uid);
    expect(detail.status).toBe(200);
    expect(detail.body.data.order.delivery_address).toBe('Private address');
    expect(detail.body.data.payments).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /private gateway|private reference|private\.example|private order|private item/,
    );
    expect((await f.get()).status).toBe(200);
  });
  it('combines literal source filters and UTC inclusive dates before bounded pagination', async () => {
    const f = await fixture(),
      a = await f.order({
        orderId: `literal%_${randomUUID()}`,
        status: 'delivered',
        createdAt: new Date('2026-01-02T23:59:59.999Z'),
      }),
      b = await f.order({ status: 'pending', createdAt: new Date('2026-01-03T00:00:00Z') });
    const r = await f.get('/data', {
      status: 'delivered',
      order_id: '%_',
      date_from: '2026-01-02',
      date_to: '2026-01-02',
      per_page: 1,
    });
    expect(r.status).toBe(200);
    expect(r.body.data.orders).toMatchObject({ total: 1, current_page: 1, per_page: 1 });
    expect(r.body.data.orders.data[0]._uid).toBe(a.uid);
    expect(
      (
        await f.get('/data', { date_from: '2026-01-03', date_to: '2026-01-03' })
      ).body.data.orders.data.some((x: any) => x._uid === b.uid),
    ).toBe(true);
    expect(
      (await f.get('/data', { order_id: a.orderId, page: 2, per_page: 1 })).body.data.orders.data,
    ).toEqual([]);
    for (const query of [
      { per_page: 101 },
      { page: 0 },
      { date_from: '2026-02-30' },
      { date_from: '2026-02-02', date_to: '2026-02-01' },
      { status: 'unknown' },
      { unexpected: 'field' },
    ])
      expect((await f.get('/data', query)).status).toBe(400);
  });
  it('masks phone values, hides addresses and denies phone filtering without current phone visibility', async () => {
    const f = await fixture(['vendor.orders.manage', 'vendor.chats.view_all']),
      row = await f.order();
    const r = await f.get('/' + row.uid);
    expect(r.status).toBe(200);
    expect(r.body.data.order.customer_phone).toBe('****3210');
    expect(r.body.data.order).not.toHaveProperty('delivery_address');
    expect((await f.get('/data', { customer_phone: '9198' })).status).toBe(403);
  });
  it('excludes foreign orders, foreign contact references, orphan and foreign payments consistently', async () => {
    const f = await fixture(),
      other = await fixture();
    const owned = await f.order(),
      foreign = await other.order();
    const contact = await db.contacts.create({
      data: { vendorId: other.vendorId, waId: '919123456789', firstName: 'Other' },
    });
    const corrupt = await f.order({ contactId: contact.id });
    await f.payment(owned.orderId);
    await other.payment(owned.orderId, { status: 'completed' });
    await f.payment('missing-order', { status: 'completed' });
    await f.payment(corrupt.orderId, { status: 'completed' });
    expect((await f.get('/' + foreign.uid)).status).toBe(404);
    expect((await f.get('/' + corrupt.uid)).status).toBe(404);
    const r = await f.get('/data');
    expect(r.body.data.orders.total).toBe(1);
    expect((await f.get('/' + owned.uid)).body.data.payments).toHaveLength(1);
    const stats = await f.get('/statistics');
    expect(stats.status).toBe(200);
    expect(stats.body.data.order_statistics.total_orders).toBe(1);
    expect(stats.body.data.payment_statistics.total_payments).toBe(1);
  });
  it('keeps exact statistics separate by currency and uses source status buckets', async () => {
    const f = await fixture(),
      a = await f.order({ status: 'delivered', currency: 'INR', totalAmount: '0.1001' }),
      b = await f.order({ status: 'shipped', currency: 'USD', totalAmount: '0.2002' });
    await f.order({ status: 'awaiting_payment', currency: 'INR' });
    await f.order({ status: 'cancelled' });
    await f.payment(a.orderId, { status: 'completed', currency: 'INR', amount: '0.1001' });
    await f.payment(b.orderId, { status: 'processing', currency: 'USD', amount: '0.2002' });
    const r = await f.get('/statistics');
    expect(r.status).toBe(200);
    expect(r.body.data.order_statistics).toMatchObject({
      total_orders: 4,
      pending_orders: 1,
      completed_orders: 1,
      cancelled_orders: 1,
      total_revenue_by_currency: { INR: '0.1001', USD: '0' },
      pending_revenue_by_currency: { USD: '0.2002' },
    });
    expect(r.body.data.payment_statistics).toMatchObject({
      total_payments: 2,
      successful_payments: 1,
      pending_payments: 1,
      total_amount_by_currency: { INR: '0.1001' },
      pending_amount_by_currency: { USD: '0.2002' },
    });
  });
  it('rechecks current membership inside read transactions and requires full visibility', async () => {
    const limited = await fixture(['vendor.orders.manage']);
    expect((await limited.get()).status).toBe(403);
    const f = await fixture(),
      original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any, options: any) =>
      original(async (tx: any) => {
        await tx.nativeMemberships.update({
          where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
          data: { permissions: [] },
        });
        return work(tx);
      }, options)) as any);
    expect((await f.get('/statistics')).status).toBe(403);
  });
  it('handles bounded encoded legacy items and rejects malformed item snapshots', async () => {
    const f = await fixture(),
      a = await f.order({
        items: JSON.stringify([
          { name: 'Legacy item', quantity: '2', item_price: '1.25', private: 'secret' },
        ]),
      });
    expect((await f.get('/' + a.uid)).body.data.order.items).toEqual([
      { name: 'Legacy item', quantity: '2', item_price: '1.25' },
    ]);
    for (const items of ['not-json', [{ quantity: -1 }], [{ item_price: 'nan' }], {}]) {
      const row = await f.order({ items });
      expect((await f.get('/' + row.uid)).status).toBe(409);
    }
  });
});

describe('original WhatsApp order status and export', () => {
  const patch = (f: any, row: any, status: string, key = randomUUID(), rev = row.revision) =>
    request(app)
      .patch(`${prefix}/${row._uid ?? row.uid}/status`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('X-Vendor-Id', String(f.vendorId))
      .set('Idempotency-Key', key)
      .send({ status, revision: rev });
  const current = async (f: any, row: any) => (await f.get('/' + row.uid)).body.data.order;
  it('updates pending states atomically, detects stale revisions and replays without duplicated audit', async () => {
    const f = await fixture(),
      original = await f.order();
    let row = await current(f, original);
    const key = randomUUID();
    const r = await patch(f, row, 'awaiting_address', key);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('awaiting_address');
    expect((await patch(f, row, 'awaiting_address', key)).body).toEqual(r.body);
    expect((await patch(f, row, 'cancelled', key)).status).toBe(409);
    expect((await patch(f, row, 'awaiting_payment')).status).toBe(409);
    row = await current(f, original);
    expect((await patch(f, row, 'awaiting_payment')).status).toBe(200);
    row = await current(f, original);
    expect((await patch(f, row, 'pending')).status).toBe(409);
    expect((await patch(f, row, 'paid')).status).toBe(409);
    expect((await patch(f, row, 'cancelled')).status).toBe(200);
    row = await current(f, original);
    expect((await patch(f, row, 'awaiting_payment')).status).toBe(409);
    expect(
      await db.auditEvents.count({ where: { actorId: f.userId, resource: 'whatsapp-order' } }),
    ).toBe(3);
  });
  it('requires reconciled matching payment for fulfillment and preserves payment states and timestamps', async () => {
    const f = await fixture(),
      original = await f.order({ status: 'paid', paymentStatus: 'completed' });
    let row = await current(f, original);
    expect((await patch(f, row, 'confirmed')).status).toBe(409);
    const payment = await f.payment(original.orderId, {
      paymentId: 'pay_' + randomUUID().replaceAll('-', ''),
      status: 'completed',
      currency: 'INR',
      amount: '19',
    });
    expect((await patch(f, row, 'confirmed')).status).toBe(409);
    const eventKey = `payment:payment.captured:${payment.paymentId}`;
    receipts.push(eventKey);
    await db.webhookReceipts.create({
      data: { provider: 'razorpay', eventKey, payload: { test: true }, processedAt: new Date() },
    });
    expect((await patch(f, row, 'confirmed')).status).toBe(200);
    row = await current(f, original);
    expect((await patch(f, row, 'shipped')).status).toBe(200);
    row = await current(f, original);
    expect(row.shipped_at).toBeTruthy();
    expect((await patch(f, row, 'delivered')).status).toBe(200);
    row = await current(f, original);
    expect(row.delivered_at).toBeTruthy();
    expect(row.payment_status).toBe('completed');
    expect(row.payment_completed_at).toBeNull();
    expect((await patch(f, row, 'refunded')).status).toBe(409);
  });
  it('blocks foreign orders, payment cancellation and missing revision or retry keys', async () => {
    const f = await fixture(),
      other = await fixture(),
      own = await f.order(),
      foreign = await other.order();
    const row = await current(f, own);
    await f.payment(own.orderId, { status: 'processing' });
    expect((await patch(f, row, 'cancelled')).status).toBe(409);
    expect((await patch(f, { uid: foreign.uid, revision: row.revision }, 'cancelled')).status).toBe(
      404,
    );
    expect(
      (
        await request(app)
          .patch(`${prefix}/${row._uid}/status`)
          .set('Authorization', `Bearer ${f.token}`)
          .set('X-Vendor-Id', String(f.vendorId))
          .send({ status: 'cancelled', revision: row.revision })
      ).status,
    ).toBe(400);
    expect((await patch(f, row, 'cancelled', randomUUID(), 'invalid')).status).toBe(400);
  });
  it('rolls back mutation and replay on audit failure and rechecks current permissions', async () => {
    const f = await fixture(),
      originalOrder = await f.order(),
      row = await current(f, originalOrder),
      original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any, options: any) =>
      original(
        async (tx: any) =>
          work({
            ...tx,
            auditEvents: {
              ...tx.auditEvents,
              create: async () => {
                throw new Error('Audit unavailable');
              },
            },
          }),
        options,
      )) as any);
    expect((await patch(f, row, 'awaiting_address')).status).toBe(500);
    vi.restoreAllMocks();
    expect((await current(f, originalOrder)).status).toBe('pending');
    expect(
      await db.configurations.count({
        where: { name: { startsWith: `legacy-order-status:${f.vendorId}:${f.userId}:` } },
      }),
    ).toBe(0);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any, options: any) =>
      original(async (tx: any) => {
        await tx.nativeMemberships.update({
          where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
          data: { permissions: [] },
        });
        return work(tx);
      }, options)) as any);
    expect((await patch(f, row, 'awaiting_address')).status).toBe(403);
  });
  it('exports exact CSV headers with literal filters, formula escaping, privacy and no silent truncation', async () => {
    const f = await fixture(['vendor.orders.manage', 'vendor.chats.view_all']),
      row = await f.order({
        customerName: '=HYPERLINK("private")',
        orderId: `literal%_${randomUUID()}`,
      });
    const r = await f.get('/export', { order_id: '%_' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    const data = parse(r.text, { columns: true });
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      'Order ID': row.orderId,
      'Customer Phone': '****3210',
      'Customer Name': String.fromCharCode(39) + '=HYPERLINK("private")',
      'Total Amount': '20.125',
      'Items Count': '1',
      'Delivery Address': '',
    });
    expect((await f.get('/export', { customer_phone: '9198' })).status).toBe(403);
    expect((await f.get('/export', { per_page: 1 })).status).toBe(400);
    const original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementationOnce(((work: any, options: any) =>
      original(
        async (tx: any) =>
          work({
            ...tx,
            $queryRaw: async () => Array.from({ length: 10001 }, (_, id) => ({ id })),
          }),
        options,
      )) as any);
    expect((await f.get('/export')).status).toBe(409);
  });
});
