import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  path = '/vendor-console/settings/out-of-office';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `7744${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-away'),
    },
  });
  const body = {
    enabled: 1,
    message: '  Away message  ',
    timezone: 'Asia/Kolkata',
    mode: 'out_of_office_now',
    manual_until: null,
    whatsapp_phone_number_id: phone,
    schedule: Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i + 1,
      enabled: i < 5 ? 1 : 0,
      intervals: i < 5 ? [{ start: '09:00', end: '18:00' }] : [],
    })),
  };
  const post = (payload: any = body, key = randomUUID()) =>
    request(app)
      .post(path)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(payload);
  const get = (phoneId = phone) =>
    request(app)
      .get(path)
      .set('Authorization', `Bearer ${f.token}`)
      .query({ phone_number_id: phoneId });
  return { ...f, phone, body, post, get };
}
describe('original out of office settings adapters', () => {
  it('saves original numeric booleans and source envelope, replays once and returns safe configuration', async () => {
    const f = await fixture(),
      key = randomUUID(),
      saved = await f.post(f.body, key);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      reaction_code: 1,
      show_message: true,
      data: { status: { ooo_active: true, reason: 'manual' } },
    });
    const row = await db.outOfOfficeSettings.findFirstOrThrow({ where: { vendorId: f.vendorId } });
    expect(row.message).toBe('Away message');
    expect(
      (
        await f.post(
          {
            ...f.body,
            enabled: true,
            schedule: f.body.schedule.map((d) => ({ ...d, enabled: !!d.enabled })),
          },
          key,
        )
      ).body,
    ).toEqual(saved.body);
    expect((await f.post({ ...f.body, message: 'Changed' }, key)).status).toBe(409);
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, resource: 'out-of-office' } }),
    ).toBe(1);
    const read = await f.get();
    expect(read.status).toBe(200);
    expect(read.body.settings).toMatchObject({
      message: 'Away message',
      whatsapp_phone_number_id: f.phone,
      enabled: true,
    });
    expect(read.body.settings).not.toHaveProperty('vendorId');
    expect(read.body.schedule).toHaveLength(7);
    await f.post({ ...f.body, message: 'Still away' });
    expect(
      (await db.outOfOfficeSettings.findUniqueOrThrow({ where: { id: row.id } })).manualStartedAt,
    ).toEqual(row.manualStartedAt);
  });
  it('uses current number defaults and expires manual periods once with atomic audit', async () => {
    const f = await fixture();
    await db.vendorSettings.createMany({
      data: [
        { vendorId: f.vendorId, name: 'current_phone_number_id', value: f.phone },
        { vendorId: f.vendorId, name: 'timezone', value: 'Asia/Kolkata' },
      ],
    });
    const defaults = await request(app).get(path).set('Authorization', `Bearer ${f.token}`);
    expect(defaults.status).toBe(200);
    expect(defaults.body.settings).toMatchObject({ enabled: false, timezone: 'Asia/Kolkata' });
    await f.post({ ...f.body, manual_until: new Date(Date.now() - 60000).toISOString() });
    expect((await f.get()).body.settings.mode).toBe('business_hours');
    await f.get();
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'expire-manual' } }),
    ).toBe(1);
  });
  it('allows an owned existing configuration to be disabled after disconnection, but cannot re-enable or create one', async () => {
    const f = await fixture();
    await f.post();
    await db.integrationCredentials.deleteMany({ where: { vendorId: f.vendorId } });
    expect((await f.get()).status).toBe(200);
    expect((await f.post({ ...f.body, enabled: 0, message: '' })).status).toBe(200);
    expect((await f.post()).status).toBe(404);
    expect(
      (await f.post({ ...f.body, enabled: 0, whatsapp_phone_number_id: '123456' })).status,
    ).toBe(404);
    expect(
      (await db.outOfOfficeSettings.findFirstOrThrow({ where: { vendorId: f.vendorId } })).enabled,
    ).toBe(false);
  });
  it('rejects foreign senders and uses distinct current view/manage permissions', async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await f.post({ ...f.body, whatsapp_phone_number_id: other.phone })).status).toBe(404);
    expect((await f.get(other.phone)).status).toBe(404);
    const viewer = await fixture(['vendor.out_of_office.view']);
    expect((await viewer.get()).status).toBe(200);
    expect((await viewer.post()).status).toBe(403);
    const key = randomUUID();
    await f.post(f.body, key);
    await db.nativeMemberships.updateMany({
      where: { vendorId: f.vendorId, userId: f.userId },
      data: { role: 'agent', permissions: [] },
    });
    expect((await f.post(f.body, key)).status).toBe(403);
    expect((await f.get()).status).toBe(403);
  });
  it('rejects malformed/overlapping schedules, unknown fields and missing keys without partial writes', async () => {
    const f = await fixture();
    for (const body of [
      { ...f.body, schedule: [] },
      { ...f.body, timezone: 'bad-zone' },
      { ...f.body, extra: true },
      { ...f.body, enabled: 2 },
      {
        ...f.body,
        schedule: f.body.schedule.map((d, i) =>
          i === 0
            ? {
                ...d,
                intervals: [
                  { start: '09:00', end: '12:00' },
                  { start: '11:00', end: '13:00' },
                ],
              }
            : d,
        ),
      },
    ])
      expect((await f.post(body)).status).toBe(400);
    expect(
      (await request(app).post(path).set('Authorization', `Bearer ${f.token}`).send(f.body)).status,
    ).toBe(400);
    expect(await db.outOfOfficeSettings.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('rolls back setting, schedule and replay records when audit cannot commit', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options),
    );
    expect((await f.post()).status).toBe(500);
    expect(await db.outOfOfficeSettings.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.nativeIdempotency.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
});
