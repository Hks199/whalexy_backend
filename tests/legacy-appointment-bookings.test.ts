import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>, foreign: typeof owner, agent: typeof owner;
let base: string,
  service: { id: number; uid: string },
  resource: { id: number; uid: string },
  foreignService: typeof service;
const tomorrow = new Date(Date.now() + 86400000);
tomorrow.setUTCHours(9, 0, 0, 0);
const at = (hour: number) => {
  const date = new Date(tomorrow);
  date.setUTCHours(hour);
  return date.toISOString();
};
const auth = () => `Bearer ${owner.token}`;
const slot = (hour: number) => ({
  service_uid: service.uid,
  resource_uid: resource.uid,
  starts_at: at(hour),
  timezone: 'UTC',
});
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  agent = await businessFixture(['vendor.appointments.view', 'vendor.appointments.manage']);
  await db.nativeMemberships.create({
    data: {
      vendorId: owner.vendorId,
      userId: agent.userId,
      role: 'agent',
      permissions: ['vendor.appointments.view', 'vendor.appointments.manage'],
    },
  });
  const vendor = await db.vendors.findUniqueOrThrow({ where: { id: owner.vendorId } });
  base = `/api/${vendor.uid}/appointments`;
  service = await db.whalexyAppointmentServices.create({
    data: { vendorId: owner.vendorId, name: 'Legacy service', durationMinutes: 30 },
  });
  resource = await db.whalexyAppointmentResources.create({
    data: { vendorId: owner.vendorId, name: 'Legacy staff', userId: owner.userId },
  });
  foreignService = await db.whalexyAppointmentServices.create({
    data: { vendorId: foreign.vendorId, name: 'Foreign service', durationMinutes: 30 },
  });
  await db.whalexyAppointmentServiceResources.create({
    data: {
      vendorId: owner.vendorId,
      appointmentServiceId: service.id,
      appointmentResourceId: resource.id,
    },
  });
  await db.whalexyAppointmentSchedules.create({
    data: {
      vendorId: owner.vendorId,
      appointmentResourceId: resource.id,
      weekday: ((tomorrow.getUTCDay() + 6) % 7) + 1,
      startLocalTime: '09:00',
      endLocalTime: '17:00',
      timezone: 'UTC',
    },
  });
});
afterAll(async () => db.$disconnect());
describe('original appointment booking API adapters', () => {
  it('lists availability across linked resources and accepts a selected resource', async () => {
    const query = { service_uid: service.uid, date: tomorrow.toISOString().slice(0, 10) };
    const response = await request(app)
      .get(`${base}/availability`)
      .set('Authorization', auth())
      .query(query);
    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      resource_uid: resource.uid,
      resource_name: 'Legacy staff',
      starts_at_utc: at(9),
      timezone: 'UTC',
    });
    expect(response.body.data.length).toBe(31);
    const selected = await request(app)
      .get(`${base}/availability`)
      .set('Authorization', auth())
      .query({ ...query, resource_uid: resource.uid });
    expect(selected.body).toEqual(response.body);
    expect(
      (
        await request(app)
          .get(`${base}/availability`)
          .set('Authorization', auth())
          .query({ ...query, service_uid: foreignService.uid })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${base}/availability`)
          .set('Authorization', auth())
          .query({ ...query, date: '2027-02-30' })
      ).status,
    ).toBe(422);
  });
  it('reserves and books without a saved contact, preserving customer details and idempotency', async () => {
    const hold = await request(app)
      .post(`${base}/holds`)
      .set('Authorization', auth())
      .send(slot(9));
    expect(hold.status).toBe(201);
    expect(hold.body.data).toMatchObject({
      vendors__id: owner.vendorId,
      contacts__id: null,
      appointment_service_id: service.id,
      appointment_resource_id: resource.id,
    });
    expect(
      (await request(app).post(`${base}/holds`).set('Authorization', auth()).send(slot(9))).body
        .code,
    ).toBe('slot_unavailable');
    const input = {
      ...slot(9),
      idempotency_key: randomUUID(),
      hold_token: hold.body.data.token,
      customer_name: 'Walk-in',
      customer_phone: '919722222222',
      customer_email: 'walkin@example.com',
      notes: 'Initial booking',
    };
    const booking = await request(app).post(base).set('Authorization', auth()).send(input);
    expect(booking.status).toBe(201);
    expect(booking.body.data).toMatchObject({
      contacts__id: null,
      customer_name: 'Walk-in',
      customer_phone: input.customer_phone,
      customer_email: input.customer_email,
      status: 'confirmed',
      starts_at_utc: at(9),
    });
    expect(
      await db.nativeBookingClaims.count({ where: { appointmentId: booking.body.data._id } }),
    ).toBe(30);
    const replay = await request(app).post(base).set('Authorization', auth()).send(input);
    expect(replay.body.data._uid).toBe(booking.body.data._uid);
    expect(
      (
        await request(app)
          .post(base)
          .set('Authorization', auth())
          .send({ ...input, customer_name: 'Changed' })
      ).status,
    ).toBe(409);
    expect(
      (
        await db.whalexyAppointmentHolds.findUniqueOrThrow({
          where: { token: hold.body.data.token },
        })
      ).convertedAt,
    ).not.toBeNull();
    const shown = await request(app)
      .get(`${base}/${booking.body.data._uid}`)
      .set('Authorization', auth());
    expect(shown.body.data.customer_name).toBe('Walk-in');
    const cancelled = await request(app)
      .post(`${base}/${booking.body.data._uid}/cancel`)
      .set('Authorization', auth());
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(
      await db.nativeBookingClaims.count({ where: { appointmentId: booking.body.data._id } }),
    ).toBe(0);
  });
  it('denies contact-free booking to assigned-chat agents and isolates tenant identifiers', async () => {
    expect(
      (
        await request(app)
          .post(`${base}/holds`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send(slot(10))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(base)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ ...slot(10), idempotency_key: randomUUID() })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(base)
          .set('Authorization', auth())
          .send({ ...slot(10), service_uid: foreignService.uid, idempotency_key: randomUUID() })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${base}/${randomUUID()}`)
          .set('Authorization', `Bearer ${foreign.token}`)
      ).status,
    ).toBe(403);
  });
  it('supports local timestamps with a timezone and masks customer identifiers without phone permission', async () => {
    const localDate = tomorrow.toISOString().slice(0, 10);
    const input = {
      ...slot(10),
      starts_at: `${localDate}T15:30:00`,
      timezone: 'Asia/Kolkata',
      idempotency_key: randomUUID(),
      customer_phone: '919733333333',
      customer_email: 'hidden@example.com',
    };
    const booking = await request(app).post(base).set('Authorization', auth()).send(input);
    expect(booking.status).toBe(201);
    expect(booking.body.data.starts_at_utc).toBe(at(10));
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: owner.vendorId, userId: agent.userId } },
      data: {
        permissions: [
          'vendor.appointments.view',
          'vendor.appointments.manage',
          'vendor.chats.view_all',
        ],
      },
    });
    const shown = await request(app)
      .get(`${base}/${booking.body.data._uid}`)
      .set('Authorization', `Bearer ${agent.token}`);
    expect(shown.status).toBe(200);
    expect(shown.body.data.customer_phone).toBe('***3333');
    expect(shown.body.data.customer_email).toBeNull();
    await request(app)
      .post(`${base}/${booking.body.data._uid}/cancel`)
      .set('Authorization', auth());
  });
  it('honors paused booking and rejects invalid/past slots', async () => {
    await db.whalexyAppointmentAutomationSettings.create({
      data: { vendorId: owner.vendorId, systemEnabled: false },
    });
    const response = await request(app)
      .post(base)
      .set('Authorization', auth())
      .send({ ...slot(11), idempotency_key: randomUUID() });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('slot_unavailable');
    expect(
      (
        await request(app)
          .get(`${base}/availability`)
          .set('Authorization', auth())
          .query({ service_uid: service.uid, date: tomorrow.toISOString().slice(0, 10) })
      ).body.data,
    ).toEqual([]);
    await db.whalexyAppointmentAutomationSettings.update({
      where: { vendorId: owner.vendorId },
      data: { systemEnabled: true },
    });
    expect(
      (
        await request(app)
          .post(`${base}/holds`)
          .set('Authorization', auth())
          .send({ ...slot(11), starts_at: '2000-01-01T09:00:00Z' })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post(`${base}/holds`)
          .set('Authorization', auth())
          .send({ ...slot(11), timezone: 'Unknown/Zone' })
      ).status,
    ).toBe(422);
  });
  it('supports contact-free native bookings without assigning unrelated chats', async () => {
    const contact = await db.contacts.create({
      data: { vendorId: owner.vendorId, firstName: 'Unrelated' },
    });
    const native = `/api/v1/vendors/${owner.vendorId}/appointments`;
    const booking = await request(app)
      .post(native)
      .set('Authorization', auth())
      .send({
        serviceId: service.id,
        resourceId: resource.id,
        startsAt: at(12),
        idempotencyKey: randomUUID(),
        customerName: 'Native guest',
      });
    expect(booking.status).toBe(201);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: contact.id } })).assignedUserId,
    ).toBeNull();
    await request(app).post(`${native}/${booking.body.id}/cancel`).set('Authorization', auth());
  });
});
