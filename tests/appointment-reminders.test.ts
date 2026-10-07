import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { createApp } from '../src/app.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { recoverInterruptedJobs } from '../src/jobs/recovery.js';
import {
  dispatchDueReminders,
  scheduleReminders,
} from '../src/modules/appointment-reminders/appointment-reminders.service.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());
async function fixture(template = false) {
  const owner = await businessFixture(),
    phone = `5577${owner.vendorId}`,
    recipient = '919744444444';
  await db.integrationCredentials.create({
    data: {
      vendorId: owner.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-reminder-credential'),
    },
  });
  const contact = await db.contacts.create({
    data: { vendorId: owner.vendorId, waId: recipient, wabPhoneNumberId: phone },
  });
  const service = await db.whalexyAppointmentServices.create({
    data: { vendorId: owner.vendorId, name: 'Consultation', durationMinutes: 30 },
  });
  const resource = await db.whalexyAppointmentResources.create({
    data: { vendorId: owner.vendorId, name: 'Doctor', timezone: 'Asia/Kolkata' },
  });
  const startsAtUtc = new Date(Date.now() + 4 * 3600000);
  const appointment = await db.whalexyAppointments.create({
    data: {
      vendorId: owner.vendorId,
      contactId: contact.id,
      customerPhone: recipient,
      appointmentServiceId: service.id,
      appointmentResourceId: resource.id,
      startsAtUtc,
      endsAtUtc: new Date(startsAtUtc.getTime() + 1800000),
      timezone: 'Asia/Kolkata',
      status: 'confirmed',
      idempotencyKey: randomUUID(),
    },
  });
  await db.whalexyAppointmentAutomationSettings.create({
    data: {
      vendorId: owner.vendorId,
      enabled: true,
      reminderOffsetsMinutes: [120],
      reminderTemplateName: template ? 'appointment_reminder' : null,
      reminderTemplateLanguage: 'en_US',
    },
  });
  if (template)
    await db.whatsappTemplates.create({
      data: {
        vendorId: owner.vendorId,
        templateName: 'appointment_reminder',
        languageCode: 'en_US',
        status: 'APPROVED',
        data: { components: [{ type: 'BODY', text: '{{1}} with {{2}} on {{3}} at {{4}}' }] },
      },
    });
  await db.$transaction((tx) => scheduleReminders(tx, appointment));
  const delivery = await db.whalexyAppointmentReminderDeliveries.findFirstOrThrow({
    where: { appointmentId: appointment.id },
  });
  return { ...owner, phone, recipient, contact, appointment, delivery };
}
async function due(f: Awaited<ReturnType<typeof fixture>>) {
  await db.whalexyAppointmentReminderDeliveries.update({
    where: { id: f.delivery.id },
    data: { scheduledFor: new Date(Date.now() - 1000) },
  });
  await dispatchDueReminders();
}
async function job(f: Awaited<ReturnType<typeof fixture>>) {
  return db.outboxJobs.findFirstOrThrow({ where: { vendorId: f.vendorId, kind: 'whatsapp-send' } });
}
describe('appointment reminder delivery', () => {
  it('creates one delivery per offset and skips offsets already too close', async () => {
    const f = await fixture();
    await db.whalexyAppointmentAutomationSettings.update({
      where: { vendorId: f.vendorId },
      data: { reminderOffsetsMinutes: [120, 120, 1440] },
    });
    await db.$transaction((tx) => scheduleReminders(tx, f.appointment));
    expect(
      await db.whalexyAppointmentReminderDeliveries.count({
        where: { appointmentId: f.appointment.id },
      }),
    ).toBe(1);
    expect(f.delivery.scheduledFor.getTime()).toBe(
      f.appointment.startsAtUtc.getTime() - 120 * 60000,
    );
  });
  it('blocks freeform reminders outside a recipient-specific service window', async () => {
    const f = await fixture();
    await due(f);
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).status,
    ).toBe('blocked');
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('queues once and renders approved template parameters without an open window', async () => {
    const f = await fixture(true);
    await due(f);
    await dispatchDueReminders();
    const queued = await job(f),
      payload = queued.payload as any;
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(payload.payload.template.components[0].parameters.slice(0, 2)).toEqual([
      { type: 'text', text: 'Consultation' },
      { type: 'text', text: 'Doctor' },
    ]);
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: `wamid.reminder.${f.vendorId}` }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await processJob(queued);
    await processJob(queued);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).status,
    ).toBe('sent');
  });
  it('cancels a queued reminder when the appointment changes before dispatch', async () => {
    const f = await fixture(true);
    await due(f);
    const queued = await job(f);
    await db.whalexyAppointments.update({
      where: { id: f.appointment.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await processJob(queued);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).status,
    ).toBe('cancelled');
  });
  it('rejects an unsupported template mapper instead of sending incorrect parameters', async () => {
    const f = await fixture(true);
    await db.whatsappTemplates.updateMany({
      where: { vendorId: f.vendorId },
      data: { data: { components: [{ type: 'BODY', text: '{{2}}' }] } },
    });
    await due(f);
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).lastError,
    ).toBe('REMINDER_TEMPLATE_PARAMETERS');
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('records interrupted delivery uncertainty and prevents automatic duplicate dispatch', async () => {
    const f = await fixture(true);
    await due(f);
    const queued = await job(f);
    await db.outboxJobs.update({
      where: { id: queued.id },
      data: { status: 'processing', lockedAt: new Date(Date.now() - 11 * 60000) },
    });
    await recoverInterruptedJobs();
    await dispatchDueReminders();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe(
      'uncertain',
    );
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).status,
    ).toBe('uncertain');
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('blocks a changed contact identity instead of delivering to the new recipient', async () => {
    const f = await fixture(true);
    await db.contacts.update({ where: { id: f.contact.id }, data: { waId: '919755555555' } });
    await due(f);
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).lastError,
    ).toBe('REMINDER_CONTACT_UNAVAILABLE');
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('recovers a committed provider identifier as completed without degrading delivery status', async () => {
    const f = await fixture(true);
    await due(f);
    const queued = await job(f);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ id: `wamid.committed.${f.vendorId}` }] })),
        ),
    );
    await processJob(queued);
    await db.outboxJobs.update({
      where: { id: queued.id },
      data: { status: 'processing', lockedAt: new Date(Date.now() - 11 * 60000) },
    });
    await recoverInterruptedJobs();
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe(
      'completed',
    );
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).status,
    ).toBe('sent');
    expect(
      (
        await db.whatsappMessageLogs.findUniqueOrThrow({
          where: { id: (queued.payload as any).messageId },
        })
      ).status,
    ).toBe('sent');
  });
  it('validates automation offsets and enforces tenant boundaries', async () => {
    const f = await fixture(),
      foreign = await businessFixture(),
      endpoint = `/api/v1/vendors/${f.vendorId}/appointments/automation`;
    expect(
      (
        await request(app)
          .put(endpoint)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ enabled: true, reminderOffsetsMinutes: [0] })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get(endpoint).set('Authorization', `Bearer ${foreign.token}`)).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put(endpoint)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ enabled: false })
      ).status,
    ).toBe(200);
    expect(
      (
        await db.whalexyAppointmentReminderDeliveries.findUniqueOrThrow({
          where: { id: f.delivery.id },
        })
      ).status,
    ).toBe('cancelled');
  });
});
