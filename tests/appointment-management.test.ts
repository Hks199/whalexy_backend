import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/utils/crypto.js';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>;
let foreign: typeof owner;
let reader: typeof owner;
let resource: { id: number; uid: string };
let service: { id: number; uid: string };
const endpoint = (path: string) => `/api/v1/vendors/${owner.vendorId}/appointments${path}`;
const auth = () => `Bearer ${owner.token}`;
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  reader = await businessFixture(['vendor.appointments.view']);
  await db.nativeMemberships.create({
    data: {
      vendorId: owner.vendorId,
      userId: reader.userId,
      role: 'agent',
      permissions: ['vendor.appointments.view'],
    },
  });
});
afterAll(async () => db.$disconnect());

describe('appointment management HTTP workflows', () => {
  it('prevents generic CRUD from bypassing appointment management invariants', async () => {
    for (const name of [
      'appointment-services',
      'appointment-resources',
      'appointment-schedules',
      'appointment-exceptions',
    ]) {
      const path = `/api/v1/vendors/${owner.vendorId}/resources/${name}`;
      expect((await request(app).post(path).set('Authorization', auth()).send({})).status).toBe(
        403,
      );
      expect(
        (await request(app).patch(`${path}/1`).set('Authorization', auth()).send({})).status,
      ).toBe(403);
    }
  });
  it('adapts original vendor-UUID URLs, snake-case inputs and resource/service envelopes', async () => {
    const vendor = await db.vendors.findUniqueOrThrow({ where: { id: owner.vendorId } });
    const base = `/api/${vendor.uid}/appointments`;
    const created = await request(app).post(`${base}/resources`).set('Authorization', auth()).send({
      name: 'API staff',
      timezone: 'UTC',
      users__id: owner.userId,
      auto_assign_chat: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      vendors__id: owner.vendorId,
      users__id: owner.userId,
      auto_assign_chat: false,
    });
    expect(created.body.data.uid).toBeUndefined();
    const resourceUid = created.body.data._uid;
    const createdService = await request(app)
      .post(`${base}/services`)
      .set('Authorization', auth())
      .send({
        name: 'API service',
        timezone: 'UTC',
        duration_minutes: 30,
        buffer_before_minutes: 5,
        resource_uids: [resourceUid],
        price: 12.5,
      });
    expect(createdService.status).toBe(201);
    expect(createdService.body.data).toMatchObject({
      duration_minutes: 30,
      buffer_before_minutes: 5,
      price: '12.50',
    });
    expect(createdService.body.data.durationMinutes).toBeUndefined();
    const schedule = await request(app)
      .put(`${base}/resources/${resourceUid}/schedule`)
      .set('Authorization', auth())
      .send({
        periods: [
          { weekday: 1, start_local_time: '09:00', end_local_time: '17:00', timezone: 'UTC' },
        ],
      });
    expect(schedule.status).toBe(200);
    expect(schedule.body).toEqual({ result: 'success' });
    expect(
      (await request(app).get(`${base}/services`).set('Authorization', auth())).body.data[0]._uid,
    ).toBe(createdService.body.data._uid);
    expect(
      (await request(app).get(`${base}/resources`).set('Authorization', auth())).body.data[0]._uid,
    ).toBe(resourceUid);
    expect(
      (
        await request(app)
          .post(`${base}/resources`)
          .set('Authorization', auth())
          .send({ name: 'Invalid' })
      ).status,
    ).toBe(422);
    await db.whalexyAppointmentServiceResources.deleteMany({
      where: { appointmentServiceId: createdService.body.data._id },
    });
    await db.whalexyAppointmentServices.delete({ where: { id: createdService.body.data._id } });
    await db.whalexyAppointmentSchedules.deleteMany({
      where: { appointmentResourceId: created.body.data._id },
    });
    await db.whalexyAppointmentResources.delete({ where: { id: created.body.data._id } });
  });
  it('enforces native API-key permissions and tenant scope on original URLs', async () => {
    const vendor = await db.vendors.findUniqueOrThrow({ where: { id: owner.vendorId } });
    const other = await db.vendors.findUniqueOrThrow({ where: { id: foreign.vendorId } });
    const key = randomUUID();
    await db.apiKeys.create({
      data: {
        vendorId: owner.vendorId,
        userId: owner.userId,
        keyHash: digest(key),
        permissions: ['vendor.appointments.view'],
      },
    });
    const base = `/api/${vendor.uid}/appointments`;
    expect(
      (await request(app).get(`${base}/resources`).set('Authorization', `ApiKey ${key}`)).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`${base}/resources`)
          .set('Authorization', `ApiKey ${key}`)
          .send({ name: 'Denied', timezone: 'UTC' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/${other.uid}/appointments/resources`)
          .set('Authorization', `ApiKey ${key}`)
      ).status,
    ).toBe(401);
    expect(
      (await request(app).get(`${base}/resources`).set('Authorization', `Bearer ${foreign.token}`))
        .status,
    ).toBe(403);
    expect((await request(app).get(`${base}/resources`).query({ token: key })).status).toBe(401);
  });
  it('requires authentication and management permission', async () => {
    expect((await request(app).get(endpoint('/resources'))).status).toBe(401);
    expect(
      (
        await request(app)
          .post(endpoint('/resources'))
          .set('Authorization', `Bearer ${reader.token}`)
          .send({ name: 'Unauthorized', timezone: 'UTC' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(endpoint('/resources'))
          .set('Authorization', `Bearer ${foreign.token}`)
      ).status,
    ).toBe(403);
  });
  it('creates resources with active business staff and rejects foreign staff', async () => {
    const invalid = await request(app)
      .post(endpoint('/resources'))
      .set('Authorization', auth())
      .send({ name: 'Foreign staff', timezone: 'UTC', userId: foreign.userId });
    expect(invalid.status).toBe(422);
    const created = await request(app)
      .post(endpoint('/resources'))
      .set('Authorization', auth())
      .send({ name: 'Consultant', timezone: 'UTC', userId: owner.userId, metadata: null });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      vendorId: owner.vendorId,
      name: 'Consultant',
      autoAssignChat: true,
      status: 'active',
      userId: owner.userId,
      metadata: null,
    });
    resource = created.body.data;
    const listed = await request(app).get(endpoint('/resources')).set('Authorization', auth());
    expect(listed.body.data.map((r: { uid: string }) => r.uid)).toContain(resource.uid);
  });
  it('validates resource timezones and prevents cross-business updates', async () => {
    expect(
      (
        await request(app)
          .post(endpoint('/resources'))
          .set('Authorization', auth())
          .send({ name: 'Bad timezone', timezone: 'Not/AZone' })
      ).status,
    ).toBe(400);
    const foreignResource = await db.whalexyAppointmentResources.create({
      data: { vendorId: foreign.vendorId, name: 'Other staff' },
    });
    expect(
      (
        await request(app)
          .put(endpoint(`/resources/${foreignResource.uid}`))
          .set('Authorization', auth())
          .send({ name: 'Hijacked', timezone: 'UTC', status: 'active' })
      ).status,
    ).toBe(404);
    const updated = await request(app)
      .put(endpoint(`/resources/${resource.uid}`))
      .set('Authorization', auth())
      .send({
        name: 'Lead consultant',
        timezone: 'UTC',
        status: 'active',
        userId: owner.userId,
        autoAssignChat: false,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.autoAssignChat).toBe(false);
    expect(
      (
        await request(app)
          .get(endpoint('/resources/not-a-uuid/schedule'))
          .set('Authorization', auth())
      ).status,
    ).toBe(400);
  });
  it('creates service links atomically and rejects foreign resources and duplicates', async () => {
    const other = await db.whalexyAppointmentResources.create({
      data: { vendorId: foreign.vendorId, name: 'Foreign resource' },
    });
    const input = {
      name: 'Consultation',
      durationMinutes: 30,
      timezone: 'UTC',
      resourceUids: [resource.uid],
      price: 25.5,
      currency: 'usd',
    };
    expect(
      (
        await request(app)
          .post(endpoint('/services'))
          .set('Authorization', auth())
          .send({ ...input, resourceUids: [resource.uid, other.uid] })
      ).status,
    ).toBe(422);
    expect(await db.whalexyAppointmentServices.count({ where: { vendorId: owner.vendorId } })).toBe(
      0,
    );
    expect(
      (
        await request(app)
          .post(endpoint('/services'))
          .set('Authorization', auth())
          .send({ ...input, resourceUids: [resource.uid, resource.uid] })
      ).status,
    ).toBe(400);
    const created = await request(app)
      .post(endpoint('/services'))
      .set('Authorization', auth())
      .send(input);
    expect(created.status).toBe(201);
    expect(created.body.data.currency).toBe('USD');
    service = created.body.data;
    const listed = await request(app).get(endpoint('/services')).set('Authorization', auth());
    expect(listed.body.data[0].resources[0]).toMatchObject({
      appointmentResourceId: resource.id,
      capacity: 1,
    });
  });
  it('updates services and preserves links when a replacement fails', async () => {
    const input = {
      name: 'Long consultation',
      durationMinutes: 45,
      timezone: 'UTC',
      resourceUids: [resource.uid],
      status: 'active',
    };
    const changed = await request(app)
      .put(endpoint(`/services/${service.uid}`))
      .set('Authorization', auth())
      .send(input);
    expect(changed.status).toBe(200);
    expect(changed.body.data.durationMinutes).toBe(45);
    expect(
      (
        await request(app)
          .put(endpoint(`/services/${service.uid}`))
          .set('Authorization', auth())
          .send({ ...input, resourceUids: [randomUUID()] })
      ).status,
    ).toBe(422);
    expect(
      await db.whalexyAppointmentServiceResources.count({
        where: { appointmentServiceId: service.id, appointmentResourceId: resource.id },
      }),
    ).toBe(1);
  });
  it('replaces schedules atomically, preserving them after invalid input', async () => {
    const path = endpoint(`/resources/${resource.uid}/schedule`);
    const period = { weekday: 1, startLocalTime: '09:00', endLocalTime: '17:00', timezone: 'UTC' };
    expect(
      (
        await request(app)
          .put(path)
          .set('Authorization', auth())
          .send({ periods: [period] })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .put(path)
          .set('Authorization', auth())
          .send({ periods: [{ ...period, endLocalTime: '08:00' }] })
      ).status,
    ).toBe(400);
    const current = await request(app).get(path).set('Authorization', auth());
    expect(current.body.data).toHaveLength(1);
    expect(current.body.data[0].startLocalTime).toBe('09:00');
    expect(
      (await request(app).put(path).set('Authorization', auth()).send({ periods: [] })).status,
    ).toBe(200);
    expect((await request(app).get(path).set('Authorization', auth())).body.data).toHaveLength(0);
  });
  it('protects resources and services with active appointments or holds', async () => {
    const booking = await db.whalexyAppointments.create({
      data: {
        vendorId: owner.vendorId,
        appointmentServiceId: service.id,
        appointmentResourceId: resource.id,
        startsAtUtc: new Date(Date.now() + 3600000),
        endsAtUtc: new Date(Date.now() + 7200000),
        idempotencyKey: randomUUID(),
        status: 'confirmed',
      },
    });
    for (const path of [`/services/${service.uid}`, `/resources/${resource.uid}`])
      expect((await request(app).delete(endpoint(path)).set('Authorization', auth())).status).toBe(
        409,
      );
    await db.whalexyAppointments.update({
      where: { id: booking.id },
      data: { status: 'cancelled' },
    });
    const hold = await db.whalexyAppointmentHolds.create({
      data: {
        vendorId: owner.vendorId,
        appointmentServiceId: service.id,
        appointmentResourceId: resource.id,
        startsAtUtc: new Date(),
        endsAtUtc: new Date(Date.now() + 3600000),
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    for (const path of [`/services/${service.uid}`, `/resources/${resource.uid}`])
      expect((await request(app).delete(endpoint(path)).set('Authorization', auth())).status).toBe(
        409,
      );
    await db.whalexyAppointmentHolds.update({
      where: { id: hold.id },
      data: { expiresAt: new Date(0) },
    });
  });
  it('creates business-wide and scoped off-duty periods and isolates deletion', async () => {
    const dates = {
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
    };
    expect(
      (
        await request(app)
          .post(endpoint('/off-duty'))
          .set('Authorization', auth())
          .send({ ...dates, endsAt: dates.startsAt })
      ).status,
    ).toBe(400);
    const all = await request(app)
      .post(endpoint('/off-duty'))
      .set('Authorization', auth())
      .send({ ...dates, reason: 'Holiday' });
    expect(all.status).toBe(201);
    expect(all.body.data.appointmentResourceId).toBe(0);
    const scoped = await request(app)
      .post(endpoint('/off-duty'))
      .set('Authorization', auth())
      .send({ ...dates, resourceId: resource.id });
    expect(scoped.status).toBe(201);
    const foreignPeriod = await db.whalexyAppointmentScheduleExceptions.create({
      data: {
        vendorId: foreign.vendorId,
        appointmentResourceId: 0,
        startsAtUtc: new Date(dates.startsAt),
        endsAtUtc: new Date(dates.endsAt),
      },
    });
    expect(
      (
        await request(app)
          .delete(endpoint(`/off-duty/${foreignPeriod.id}`))
          .set('Authorization', auth())
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get(endpoint('/off-duty')).set('Authorization', auth())).body.data,
    ).toHaveLength(2);
    expect(
      (
        await request(app)
          .delete(endpoint(`/off-duty/${all.body.data.id}`))
          .set('Authorization', auth())
      ).status,
    ).toBe(204);
  });
  it('deletes unused services and resources together with setup records', async () => {
    expect(
      (
        await request(app)
          .delete(endpoint(`/services/${service.uid}`))
          .set('Authorization', auth())
      ).status,
    ).toBe(204);
    expect(
      await db.whalexyAppointmentServiceResources.count({
        where: { appointmentServiceId: service.id },
      }),
    ).toBe(0);
    expect(
      (
        await request(app)
          .delete(endpoint(`/resources/${resource.uid}`))
          .set('Authorization', auth())
      ).status,
    ).toBe(204);
    expect(
      await db.whalexyAppointmentScheduleExceptions.count({
        where: { vendorId: owner.vendorId, appointmentResourceId: resource.id },
      }),
    ).toBe(0);
    expect(
      (
        await request(app)
          .delete(endpoint(`/resources/${resource.uid}`))
          .set('Authorization', auth())
      ).status,
    ).toBe(404);
  });
});
