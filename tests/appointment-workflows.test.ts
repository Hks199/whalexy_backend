import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>,
  foreign: typeof owner,
  serviceId: number,
  resourceId: number,
  contactId: number;
const tomorrow = new Date(Date.now() + 86400000);
tomorrow.setUTCHours(9, 0, 0, 0);
const date = tomorrow.toISOString().slice(0, 10);
const at = (hour: number) => {
  const value = new Date(tomorrow);
  value.setUTCHours(hour);
  return value.toISOString();
};
const endpoint = (path = '') => `/api/v1/vendors/${owner.vendorId}/appointments${path}`;
const auth = () => `Bearer ${owner.token}`;
const book = (hour: number) =>
  request(app)
    .post(endpoint())
    .set('Authorization', auth())
    .send({ serviceId, resourceId, contactId, startsAt: at(hour), idempotencyKey: randomUUID() });
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  serviceId = (
    await db.whalexyAppointmentServices.create({
      data: { vendorId: owner.vendorId, name: 'Session', durationMinutes: 30 },
    })
  ).id;
  resourceId = (
    await db.whalexyAppointmentResources.create({
      data: { vendorId: owner.vendorId, name: 'Staff', userId: owner.userId, timezone: 'UTC' },
    })
  ).id;
  await db.whalexyAppointmentServiceResources.create({
    data: {
      vendorId: owner.vendorId,
      appointmentServiceId: serviceId,
      appointmentResourceId: resourceId,
    },
  });
  await db.whalexyAppointmentSchedules.createMany({
    data: Array.from({ length: 7 }, (_, i) => ({
      vendorId: owner.vendorId,
      appointmentResourceId: resourceId,
      weekday: i + 1,
      startLocalTime: '09:00:00',
      endLocalTime: '12:00:00',
      timezone: 'UTC',
    })),
  });
  contactId = (
    await db.contacts.create({
      data: { vendorId: owner.vendorId, firstName: 'Customer', waId: '919722222222' },
    })
  ).id;
});
afterAll(async () => db.$disconnect());
describe('appointment availability and lifecycle', () => {
  it('lists fifteen-minute slots, rejects invalid dates and foreign business access', async () => {
    const get = await request(app)
      .get(endpoint('/availability'))
      .query({ serviceId, resourceId, date })
      .set('Authorization', auth());
    expect(get.status).toBe(200);
    expect(get.body.slots).toHaveLength(11);
    expect(new Date(get.body.slots[0].startsAt).toISOString()).toBe(at(9));
    expect(
      (
        await request(app)
          .get(endpoint('/availability'))
          .query({ serviceId, resourceId, date: '2027-02-30' })
          .set('Authorization', auth())
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(endpoint('/availability'))
          .query({ serviceId, resourceId, date })
          .set('Authorization', `Bearer ${foreign.token}`)
      ).status,
    ).toBe(403);
  });
  it('blocks imported appointments that have no native claims', async () => {
    const imported = await db.whalexyAppointments.create({
      data: {
        vendorId: owner.vendorId,
        contactId,
        appointmentServiceId: serviceId,
        appointmentResourceId: resourceId,
        startsAtUtc: new Date(at(10)),
        endsAtUtc: new Date(new Date(at(10)).getTime() + 1800000),
        idempotencyKey: randomUUID(),
        status: 'confirmed',
      },
    });
    expect((await book(10)).status).toBe(409);
    await db.whalexyAppointments.update({
      where: { id: imported.id },
      data: { status: 'cancelled' },
    });
  });
  it('blocks legacy five-minute claims and global off-duty periods', async () => {
    const claim = await db.whalexyAppointmentSlotClaims.create({
      data: {
        vendorId: owner.vendorId,
        appointmentId: 2147483647,
        appointmentResourceId: resourceId,
        slotStartUtc: new Date(at(10)),
      },
    });
    expect((await book(10)).status).toBe(409);
    await db.whalexyAppointmentSlotClaims.delete({ where: { id: claim.id } });
    const exception = await db.whalexyAppointmentScheduleExceptions.create({
      data: {
        vendorId: owner.vendorId,
        appointmentResourceId: 0,
        startsAtUtc: new Date(at(10)),
        endsAtUtc: new Date(at(11)),
      },
    });
    expect((await book(10)).status).toBe(409);
    await db.whalexyAppointmentScheduleExceptions.delete({ where: { id: exception.id } });
  });
  it('keeps the original slot on rejected reschedule and transfers claims atomically on success', async () => {
    const original = await book(9),
      conflict = await book(10);
    expect(original.status).toBe(201);
    expect(conflict.status).toBe(201);
    expect((await db.contacts.findUniqueOrThrow({ where: { id: contactId } })).assignedUserId).toBe(
      owner.userId,
    );
    expect(
      (
        await request(app)
          .post(endpoint(`/${original.body.id}/reschedule`))
          .set('Authorization', auth())
          .send({ startsAt: at(10) })
      ).status,
    ).toBe(409);
    expect(
      (
        await db.whalexyAppointments.findUniqueOrThrow({ where: { id: original.body.id } })
      ).startsAtUtc.toISOString(),
    ).toBe(at(9));
    expect(await db.nativeBookingClaims.count({ where: { appointmentId: original.body.id } })).toBe(
      30,
    );
    await db.whalexyAppointmentReminderDeliveries.create({
      data: {
        vendorId: owner.vendorId,
        appointmentId: original.body.id,
        offsetMinutes: 60,
        scheduledFor: new Date(at(8)),
      },
    });
    const moved = await request(app)
      .post(endpoint(`/${original.body.id}/reschedule`))
      .set('Authorization', auth())
      .send({ startsAt: at(11) });
    expect(moved.status).toBe(200);
    expect(moved.body.startsAt).toBe(at(11));
    expect(
      await db.nativeBookingClaims.count({
        where: { appointmentId: original.body.id, slot: { lt: new Date(at(11)) } },
      }),
    ).toBe(0);
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findFirstOrThrow({
          where: { appointmentId: original.body.id },
        })
      ).status,
    ).toBe('cancelled');
    expect(
      (
        await request(app)
          .post(endpoint(`/${original.body.id}/no-show`))
          .set('Authorization', auth())
      ).status,
    ).toBe(204);
    expect(await db.nativeBookingClaims.count({ where: { appointmentId: original.body.id } })).toBe(
      0,
    );
    expect(
      (
        await request(app)
          .post(endpoint(`/${conflict.body.id}/cancel`))
          .set('Authorization', auth())
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post(endpoint(`/${conflict.body.id}/reschedule`))
          .set('Authorization', auth())
          .send({ startsAt: at(11) })
      ).status,
    ).toBe(409);
  });
  it('honors system-disabled booking and hides all availability', async () => {
    await db.whalexyAppointmentAutomationSettings.create({
      data: { vendorId: owner.vendorId, systemEnabled: false },
    });
    expect((await book(9)).status).toBe(409);
    const get = await request(app)
      .get(endpoint('/availability'))
      .query({ serviceId, resourceId, date })
      .set('Authorization', auth());
    expect(get.body.slots).toEqual([]);
    await db.whalexyAppointmentAutomationSettings.update({
      where: { vendorId: owner.vendorId },
      data: { systemEnabled: true },
    });
  });
  it('permits configured buffers outside working hours and uses schedule timezone', async () => {
    await db.whalexyAppointmentServices.update({
      where: { id: serviceId },
      data: { bufferBeforeMinutes: 15 },
    });
    const booked = await book(9);
    expect(booked.status).toBe(201);
    expect(await db.nativeBookingClaims.count({ where: { appointmentId: booked.body.id } })).toBe(
      45,
    );
    await request(app)
      .post(endpoint(`/${booked.body.id}/cancel`))
      .set('Authorization', auth());
    await db.whalexyAppointmentServices.update({
      where: { id: serviceId },
      data: { bufferBeforeMinutes: 0 },
    });
  });
  it('generates slots with the correct offset across daylight saving', async () => {
    const resource = await db.whalexyAppointmentResources.create({
      data: { vendorId: owner.vendorId, name: 'DST resource', timezone: 'America/New_York' },
    });
    await db.whalexyAppointmentServiceResources.create({
      data: {
        vendorId: owner.vendorId,
        appointmentServiceId: serviceId,
        appointmentResourceId: resource.id,
      },
    });
    await db.whalexyAppointmentSchedules.create({
      data: {
        vendorId: owner.vendorId,
        appointmentResourceId: resource.id,
        weekday: 7,
        startLocalTime: '09:00:00',
        endLocalTime: '10:00:00',
        timezone: 'America/New_York',
      },
    });
    const get = await request(app)
      .get(endpoint('/availability'))
      .query({ serviceId, resourceId: resource.id, date: '2027-03-14' })
      .set('Authorization', auth());
    expect(get.status).toBe(200);
    expect(get.body.slots).toHaveLength(3);
    expect(get.body.slots[0].startsAt).toBe('2027-03-14T13:00:00.000Z');
  });
});
