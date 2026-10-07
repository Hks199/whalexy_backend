import { DateTime } from 'luxon';
import { Prisma, type WhalexyAppointments } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { customerWindowOpen } from '../messaging/services/whatsapp.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { DEFAULT_REMINDER } from './appointment-reminders.constants.js';

export { DEFAULT_REMINDER } from './appointment-reminders.constants.js';
export async function scheduleReminders(
  tx: Prisma.TransactionClient,
  appointment: WhalexyAppointments,
  at = new Date(),
) {
  const setting = await tx.whalexyAppointmentAutomationSettings.findUnique({
    where: { vendorId: appointment.vendorId },
  });
  if (!setting?.enabled || !setting.systemEnabled) return;
  const offsets = Array.isArray(setting.reminderOffsetsMinutes)
    ? [...new Set(setting.reminderOffsetsMinutes.map(Number))]
    : [];
  if (
    offsets.length > 20 ||
    offsets.some((offset) => !Number.isInteger(offset) || offset < 1 || offset > 525600)
  )
    throw new ApiError(
      409,
      'INVALID_REMINDER_OFFSETS',
      'Reminder offsets need valid configuration',
    );
  for (const offsetMinutes of offsets) {
    const scheduledFor = new Date(appointment.startsAtUtc.getTime() - offsetMinutes * 60000);
    if (scheduledFor.getTime() <= at.getTime() + 60000) continue;
    await tx.whalexyAppointmentReminderDeliveries.upsert({
      where: { appointmentId_offsetMinutes: { appointmentId: appointment.id, offsetMinutes } },
      create: {
        vendorId: appointment.vendorId,
        appointmentId: appointment.id,
        offsetMinutes,
        scheduledFor,
      },
      update: {
        scheduledFor,
        status: 'pending',
        attempts: 0,
        sentAt: null,
        lastError: null,
        updatedAt: at,
      },
    });
  }
}
export async function reminderPhone(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contactPhoneId: string | null,
) {
  const connections = await tx.integrationCredentials.findMany({
    where: { vendorId, provider: 'whatsapp' },
    select: { externalId: true },
    take: 101,
  });
  if (contactPhoneId && connections.some((c) => c.externalId === contactPhoneId))
    return contactPhoneId;
  const current = await tx.vendorSettings.findFirst({
    where: { vendorId, name: 'current_phone_number_id' },
    select: { value: true },
  });
  if (current?.value && connections.some((c) => c.externalId === current.value))
    return current.value;
  if (connections.length === 1) return connections[0].externalId;
  throw new ApiError(
    503,
    'REMINDER_PHONE_NOT_CONFIGURED',
    'Select a connected business number for appointment reminders',
  );
}
export async function dispatchDueReminders(at = new Date()) {
  const deliveries = await db.whalexyAppointmentReminderDeliveries.findMany({
    where: { status: 'pending', scheduledFor: { lte: at } },
    orderBy: { scheduledFor: 'asc' },
    take: 100,
  });
  let queued = 0;
  for (const delivery of deliveries) {
    try {
      const processed = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(605, ${delivery.id}::integer)`;
          const claimed = await tx.whalexyAppointmentReminderDeliveries.updateMany({
            where: { id: delivery.id, status: 'pending', scheduledFor: { lte: at } },
            data: { status: 'processing', attempts: { increment: 1 }, updatedAt: at },
          });
          if (!claimed.count) return false;
          const appointment = await tx.whalexyAppointments.findFirst({
            where: { id: delivery.appointmentId, vendorId: delivery.vendorId },
          });
          if (!appointment || appointment.status !== 'confirmed' || appointment.startsAtUtc <= at) {
            await tx.whalexyAppointmentReminderDeliveries.update({
              where: { id: delivery.id },
              data: { status: 'cancelled' },
            });
            return false;
          }
          const setting = await tx.whalexyAppointmentAutomationSettings.findUnique({
            where: { vendorId: delivery.vendorId },
          });
          if (!setting?.enabled || !setting.systemEnabled) {
            await tx.whalexyAppointmentReminderDeliveries.update({
              where: { id: delivery.id },
              data: { status: 'cancelled' },
            });
            return false;
          }
          const vendor = await tx.vendors.findUnique({
            where: { id: delivery.vendorId },
            select: { status: true },
          });
          if (vendor?.status !== 1)
            throw new ApiError(403, 'BUSINESS_INACTIVE', 'Business is inactive');
          // Legacy WhatsApp contacts may have no platform marker; explicit social contacts are excluded.
          const contactScope = {
            vendorId: delivery.vendorId,
            OR: [{ platform: 'whatsapp' }, { platform: null }],
          };
          const contact = appointment.contactId
            ? await tx.contacts.findFirst({ where: { ...contactScope, id: appointment.contactId } })
            : appointment.customerPhone
              ? await tx.contacts.findFirst({
                  where: { ...contactScope, waId: appointment.customerPhone },
                })
              : null;
          if (
            !contact?.waId ||
            !/^\d{5,20}$/.test(contact.waId) ||
            (appointment.customerPhone && appointment.customerPhone !== contact.waId)
          )
            throw new ApiError(
              409,
              'REMINDER_CONTACT_UNAVAILABLE',
              'Appointment recipient is unavailable',
            );
          const phoneNumberId = await reminderPhone(
            tx,
            delivery.vendorId,
            contact.wabPhoneNumberId,
          );
          const [service, resource] = await Promise.all([
            tx.whalexyAppointmentServices.findFirst({
              where: { id: appointment.appointmentServiceId, vendorId: delivery.vendorId },
            }),
            tx.whalexyAppointmentResources.findFirst({
              where: { id: appointment.appointmentResourceId, vendorId: delivery.vendorId },
            }),
          ]);
          const local = DateTime.fromJSDate(appointment.startsAtUtc, {
            zone: appointment.timezone,
          });
          if (!local.isValid)
            throw new ApiError(409, 'INVALID_TIMEZONE', 'Appointment timezone is invalid');
          const values = [
            service?.name ?? 'Appointment',
            resource?.name ?? 'our team',
            local.toFormat('dd LLL yyyy'),
            local.toFormat('hh:mm a'),
          ];
          const replacement: Record<string, string> = {
            service: values[0],
            resource: values[1],
            date: values[2],
            time: values[3],
          };
          const text = (setting.reminderMessage || DEFAULT_REMINDER).replace(
            /\{(service|resource|date|time)\}/g,
            (_, name: string) => replacement[name],
          );
          let payload: Prisma.InputJsonObject = { messaging_product: 'whatsapp', to: contact.waId };
          if (setting.reminderTemplateName) {
            const template = await tx.whatsappTemplates.findFirst({
              where: {
                vendorId: delivery.vendorId,
                templateName: setting.reminderTemplateName,
                languageCode: setting.reminderTemplateLanguage,
                status: 'APPROVED',
              },
            });
            if (!template)
              throw new ApiError(
                409,
                'REMINDER_TEMPLATE_UNAVAILABLE',
                'Approved reminder template is unavailable',
              );
            const data = template.data as any,
              components = data?.components ?? data?.template?.components ?? [];
            if (
              !Array.isArray(components) ||
              components.some(
                (c) =>
                  !c || typeof c !== 'object' || Array.isArray(c) || typeof c.type !== 'string',
              )
            )
              throw new ApiError(
                409,
                'REMINDER_TEMPLATE_PARAMETERS',
                'Reminder template needs valid parameter configuration',
              );
            const numbers = [
              ...new Set<number>(
                components
                  .filter((c: any) => String(c.type).toUpperCase() === 'BODY')
                  .flatMap((c: any) =>
                    [...String(c.text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])),
                  ),
              ),
            ].sort((a, b) => a - b);
            if (
              numbers.length > 4 ||
              numbers.some((n, i) => n !== i + 1) ||
              components.some(
                (c: any) =>
                  String(c.type).toUpperCase() !== 'BODY' && JSON.stringify(c).includes('{{'),
              )
            )
              throw new ApiError(
                409,
                'REMINDER_TEMPLATE_PARAMETERS',
                'Reminder template parameters require a verified mapper',
              );
            payload = {
              ...payload,
              type: 'template',
              template: {
                name: template.templateName,
                language: { code: template.languageCode },
                components: numbers.length
                  ? [
                      {
                        type: 'body',
                        parameters: values
                          .slice(0, numbers.length)
                          .map((value) => ({ type: 'text', text: value })),
                      },
                    ]
                  : [],
              },
            };
          } else {
            if (
              !(await customerWindowOpen(
                delivery.vendorId,
                contact.id,
                phoneNumberId,
                contact.waId,
                at,
                tx,
              ))
            )
              throw new ApiError(
                409,
                'REMINDER_TEMPLATE_REQUIRED',
                'An approved reminder template is required outside the customer service window',
              );
            payload = { ...payload, type: 'text', text: { body: text, preview_url: false } };
          }
          const log = await tx.whatsappMessageLogs.create({
            data: {
              vendorId: delivery.vendorId,
              contactId: contact.id,
              contactWaId: contact.waId,
              wabPhoneNumberId: phoneNumberId,
              message: text,
              type: String(payload.type),
              status: 'queued',
              isIncomingMessage: false,
              messagedAt: at,
            },
          });
          await tx.outboxJobs.create({
            data: {
              vendorId: delivery.vendorId,
              kind: 'whatsapp-send',
              dedupeKey: `reminder:${delivery.id}:${appointment.updatedAt.getTime()}`,
              payload: {
                reminderDeliveryId: delivery.id,
                appointmentId: appointment.id,
                appointmentRevision: appointment.updatedAt.toISOString(),
                scheduledFor: delivery.scheduledFor.toISOString(),
                messageId: log.id,
                phoneNumberId,
                payload,
              },
            },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
      );
      if (processed) queued++;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      await db.whalexyAppointmentReminderDeliveries.updateMany({
        where: { id: delivery.id, status: 'pending' },
        data: { status: 'blocked', lastError: error.code, updatedAt: at },
      });
    }
  }
  return queued;
}
export async function getReminderSettings(requestInput: ServiceContext) {
  return serviceResult(
    await db.whalexyAppointmentAutomationSettings.findUnique({
      where: { vendorId: requestInput.identity!.vendorId! },
    }),
    { status: 200, format: 'json' },
  );
}
export async function updateReminderSettings(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  const setting = await db.$transaction(async (tx) => {
    const setting = await tx.whalexyAppointmentAutomationSettings.upsert({
      where: { vendorId },
      create: { vendorId, ...requestInput.body },
      update: { ...requestInput.body, updatedAt: new Date() },
    });
    if (!setting.enabled || !setting.systemEnabled)
      await tx.whalexyAppointmentReminderDeliveries.updateMany({
        where: { vendorId, status: 'pending' },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'configure',
        resource: 'appointment-automation',
      },
    });
    return setting;
  });
  return serviceResult(setting, { status: 200, format: 'json' });
}
