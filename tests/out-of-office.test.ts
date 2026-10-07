import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  awayState,
  defaultSchedule,
  queueAwayReply,
} from '../src/modules/out-of-office/out-of-office.service.js';
import { awaySchema } from '../src/modules/out-of-office/out-of-office.validation.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { createApp } from '../src/app.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';
const settings = () => ({
  enabled: true,
  timezone: 'Asia/Kolkata',
  mode: 'business_hours',
  manualUntil: null as Date | null,
  manualStartedAt: null as Date | null,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
});
const local = (value: string, zone = 'Asia/Kolkata') =>
  DateTime.fromSQL(value, { zone }).toJSDate();
const form = () =>
  Array.from({ length: 7 }, (_, i) => ({
    day_of_week: i + 1,
    enabled: i < 5,
    intervals: i < 5 ? [{ start: '09:00', end: '18:00' }] : [],
  }));

describe('Laravel out-of-office schedule cases', () => {
  it.each([
    ['2026-08-10 08:59:59', false],
    ['2026-08-10 09:00:00', true],
    ['2026-08-10 12:00:00', true],
    ['2026-08-10 17:59:59', true],
    ['2026-08-10 18:00:00', false],
    ['2026-08-15 10:00:00', false],
    ['2026-08-16 10:00:00', false],
  ])('evaluates %s with opening state %s', (at, open) => {
    const state = awayState(settings(), defaultSchedule(), local(at));
    expect(state.business_open).toBe(open);
    expect(state.ooo_active).toBe(!open);
  });
  it('uses one continuous weekend period and Monday opening', () => {
    const states = ['2026-08-14 19:00:00', '2026-08-15 12:00:00', '2026-08-16 20:00:00'].map((at) =>
      awayState(settings(), defaultSchedule(), local(at)),
    );
    expect(new Set(states.map((s) => s.period_key)).size).toBe(1);
    expect(states[2].next_opening).toBe('2026-08-17T09:00:00.000+05:30');
  });
  it('separates split-shift closed periods and converts UTC correctly', () => {
    const rows = defaultSchedule()
      .filter((r) => r.dayOfWeek !== 1)
      .concat([
        { dayOfWeek: 1, enabled: true, startTime: '09:00:00', endTime: '13:00:00' },
        { dayOfWeek: 1, enabled: true, startTime: '14:00:00', endTime: '18:00:00' },
      ]);
    expect(awayState(settings(), rows, local('2026-08-10 13:30:00')).period_key).not.toBe(
      awayState(settings(), rows, local('2026-08-10 18:30:00')).period_key,
    );
    expect(awayState(settings(), rows, local('2026-08-10 14:30:00')).business_open).toBe(true);
    expect(awayState(settings(), rows, new Date('2026-08-10T03:30:00Z')).business_open).toBe(true);
  });
  it('handles disabled, always-available and expired manual modes', () => {
    const current = settings();
    current.enabled = false;
    expect(awayState(current, [], local('2026-08-10 20:00:00')).ooo_active).toBe(false);
    current.enabled = true;
    current.mode = 'always_available';
    expect(awayState(current, [], local('2026-08-10 20:00:00')).ooo_active).toBe(false);
    current.mode = 'out_of_office_now';
    current.manualUntil = new Date('2026-08-10T06:30:00Z');
    current.manualStartedAt = new Date('2026-08-10T04:30:00Z');
    expect(awayState(current, defaultSchedule(), local('2026-08-10 11:00:00')).period_key).toBe(
      'manual:20260810043000',
    );
    expect(awayState(current, defaultSchedule(), local('2026-08-10 12:30:00')).business_open).toBe(
      true,
    );
  });
  it('uses local calendar days across spring and autumn daylight-saving changes', () => {
    const current = { ...settings(), timezone: 'America/New_York' },
      rows = [{ dayOfWeek: 7, enabled: true, startTime: '09:00:00', endTime: '18:00:00' }];
    const spring = awayState(current, rows, new Date('2026-03-08T12:59:00Z'));
    expect(spring.next_opening).toBe('2026-03-08T09:00:00.000-04:00');
    const autumn = awayState(current, rows, new Date('2026-11-01T13:59:00Z'));
    expect(autumn.next_opening).toBe('2026-11-01T09:00:00.000-05:00');
  });
  it('rejects overlapping hours, missing days and invalid timezones', () => {
    const input = {
      enabled: true,
      message: 'Away',
      timezone: 'UTC',
      mode: 'business_hours',
      whatsapp_phone_number_id: '123456789',
      schedule: form(),
    };
    expect(awaySchema.validate(input).error).toBeUndefined();
    expect(awaySchema.validate({ ...input, timezone: 'Not/A/Timezone' }).error).toBeTruthy();
    expect(awaySchema.validate({ ...input, schedule: form().slice(1) }).error).toBeTruthy();
    const schedule = form();
    schedule[0].intervals.push({ start: '12:00', end: '19:00' });
    expect(awaySchema.validate({ ...input, schedule }).error).toBeTruthy();
  });
});

const app = createApp(),
  run = randomUUID();
let owner: Awaited<ReturnType<typeof businessFixture>>,
  foreign: typeof owner,
  phone: string,
  contactId: number;
const path = () => `/api/v1/vendors/${owner.vendorId}/out-of-office`;
const auth = () => `Bearer ${owner.token}`;
const payload = () => ({
  enabled: true,
  message: 'We are away',
  timezone: 'UTC',
  mode: 'out_of_office_now',
  whatsapp_phone_number_id: phone,
  schedule: form(),
});
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  phone = `4455${owner.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: owner.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-only-away-provider-token'),
    },
  });
  contactId = (
    await db.contacts.create({
      data: { vendorId: owner.vendorId, waId: '919711111111', platform: 'whatsapp' },
    })
  ).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
describe('out-of-office configuration and durable delivery', () => {
  it('uses the business current number and timezone for unsaved defaults', async () => {
    await db.vendorSettings.createMany({
      data: [
        { vendorId: owner.vendorId, name: 'current_phone_number_id', value: phone },
        { vendorId: owner.vendorId, name: 'timezone', value: 'Asia/Kolkata' },
      ],
    });
    const get = await request(app).get(path()).set('Authorization', auth());
    expect(get.status).toBe(200);
    expect(get.body.phone_number_id).toBe(phone);
    expect(get.body.settings.timezone).toBe('Asia/Kolkata');
    expect(get.body.settings.enabled).toBe(false);
  });
  it('saves schedules, keeps one manual-period start and returns configuration', async () => {
    expect(
      (await request(app).post(path()).set('Authorization', auth()).send(payload())).status,
    ).toBe(200);
    const first = await db.outOfOfficeSettings.findUniqueOrThrow({
      where: {
        vendorId_whatsappPhoneNumberId: { vendorId: owner.vendorId, whatsappPhoneNumberId: phone },
      },
    });
    expect(
      (
        await request(app)
          .post(path())
          .set('Authorization', auth())
          .send({ ...payload(), message: 'Still away' })
      ).status,
    ).toBe(200);
    const second = await db.outOfOfficeSettings.findUniqueOrThrow({ where: { id: first.id } });
    expect(second.manualStartedAt).toEqual(first.manualStartedAt);
    expect(
      await db.outOfOfficeSchedules.count({ where: { outOfOfficeSettingsId: first.id } }),
    ).toBe(7);
    const get = await request(app)
      .get(path())
      .query({ phone_number_id: phone })
      .set('Authorization', auth());
    expect(get.status).toBe(200);
    expect(get.body.status.ooo_active).toBe(true);
    expect(get.body.schedule).toHaveLength(7);
  });
  it('rejects foreign phone connections and business access', async () => {
    expect(
      (
        await request(app)
          .post(path())
          .set('Authorization', auth())
          .send({ ...payload(), whatsapp_phone_number_id: '987654321' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(path())
          .query({ phone_number_id: phone })
          .set('Authorization', `Bearer ${foreign.token}`)
      ).status,
    ).toBe(403);
  });
  it('queues only one away reply for repeated inbound messages in one manual period', async () => {
    const inbound = (id: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phone },
                messages: [
                  {
                    id,
                    from: '919711111111',
                    type: 'text',
                    text: { body: 'Hello' },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await ingestMeta(inbound(`away-${run}-1`));
    await ingestMeta(inbound(`away-${run}-2`));
    await ingestMeta(inbound(`away-${run}-1`));
    const delivery = await db.outOfOfficeDeliveries.findFirstOrThrow({ where: { contactId } });
    expect(delivery.status).toBe('processing');
    expect(await db.outboxJobs.count({ where: { dedupeKey: `ooo:${delivery.id}` } })).toBe(1);
    const job = await db.outboxJobs.findUniqueOrThrow({
      where: { dedupeKey: `ooo:${delivery.id}` },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `away-sent-${run}` }] })),
        ),
    );
    await processJob(job);
    const sent = await db.outOfOfficeDeliveries.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(sent.status).toBe('sent');
    expect(sent.outboundMessageId).toBe(`away-sent-${run}`);
    expect(sent.sentAt).not.toBeNull();
  });
  it('does not automatically retry uncertain external effects', async () => {
    const contact = await db.contacts.findUniqueOrThrow({ where: { id: contactId } });
    const delivery = await db.outOfOfficeDeliveries.findFirstOrThrow({ where: { contactId } });
    await db.outOfOfficeDeliveries.update({
      where: { id: delivery.id },
      data: { status: 'uncertain' },
    });
    await db.outboxJobs.update({
      where: { dedupeKey: `ooo:${delivery.id}` },
      data: { status: 'uncertain' },
    });
    await db.$transaction((tx) =>
      queueAwayReply(tx, owner.vendorId, phone, contact, `away-uncertain-${run}`, new Date()),
    );
    expect(
      (await db.outboxJobs.findUniqueOrThrow({ where: { dedupeKey: `ooo:${delivery.id}` } }))
        .status,
    ).toBe('uncertain');
  });
  it('expires manual mode on configuration read without dropping schedules', async () => {
    const current = await db.outOfOfficeSettings.findUniqueOrThrow({
      where: {
        vendorId_whatsappPhoneNumberId: { vendorId: owner.vendorId, whatsappPhoneNumberId: phone },
      },
    });
    await db.outOfOfficeSettings.update({
      where: { id: current.id },
      data: { manualUntil: new Date(0) },
    });
    expect(
      (
        await request(app)
          .get(path())
          .query({ phone_number_id: phone })
          .set('Authorization', auth())
      ).status,
    ).toBe(200);
    const restored = await db.outOfOfficeSettings.findUniqueOrThrow({ where: { id: current.id } });
    expect(restored.mode).toBe('business_hours');
    expect(restored.manualUntil).toBeNull();
    expect(restored.manualStartedAt).toBeNull();
    expect(
      await db.outOfOfficeSchedules.count({ where: { outOfOfficeSettingsId: current.id } }),
    ).toBe(7);
  });
});
