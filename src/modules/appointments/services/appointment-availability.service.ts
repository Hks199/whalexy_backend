import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { visibleContact } from '../../contacts/contacts.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { getAppointmentResource, validateAppointmentSlot } from './appointments-support.service.js';

export async function getAppointmentAvailability(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { serviceId, resourceId, date } = requestInput.validatedQuery;
  const result = await db.$transaction(
    async (tx) => {
      const { service, resource } = await getAppointmentResource(
        tx,
        vendorId,
        serviceId,
        resourceId,
      );
      const localDate = DateTime.fromISO(date, { zone: resource.timezone });
      if (!localDate.isValid) throw new ApiError(400, 'INVALID_DATE', 'Invalid availability date');
      const automation = await tx.whalexyAppointmentAutomationSettings.findUnique({
        where: { vendorId },
      });
      if (automation?.systemEnabled === false) return [];
      const schedules = await tx.whalexyAppointmentSchedules.findMany({
        where: { vendorId, appointmentResourceId: resourceId, weekday: localDate.weekday },
        take: 101,
      });
      if (schedules.length > 100)
        throw new ApiError(409, 'SCHEDULE_LIMIT', 'Resource schedule requires consolidation');
      const slots = new Map<
        string,
        {
          startsAt: string;
          endsAt: string;
          startsAtLocal: string;
          resourceId: number;
          timezone: string;
        }
      >();
      const candidates = new Map<number, DateTime>();
      for (const schedule of schedules) {
        let cursor = DateTime.fromISO(`${date}T${schedule.startLocalTime}`, {
          zone: schedule.timezone || resource.timezone,
        });
        const until = DateTime.fromISO(`${date}T${schedule.endLocalTime}`, {
          zone: schedule.timezone || resource.timezone,
        });
        if (!cursor.isValid || !until.isValid) continue;
        while (cursor.plus({ minutes: service.durationMinutes }) <= until) {
          if (cursor.toMillis() > Date.now()) candidates.set(cursor.toMillis(), cursor);
          if (candidates.size > 512)
            throw new ApiError(409, 'SCHEDULE_LIMIT', 'Resource schedule requires consolidation');
          cursor = cursor.plus({ minutes: 15 });
        }
      }
      for (const cursor of candidates.values()) {
        try {
          const { end } = await validateAppointmentSlot(
            tx,
            vendorId,
            service,
            resource,
            cursor.toJSDate(),
          );
          const key = cursor.toUTC().toISO()!;
          slots.set(key, {
            startsAt: key,
            endsAt: end.toISOString(),
            startsAtLocal: cursor.setZone(resource.timezone).toISO()!,
            resourceId,
            timezone: resource.timezone,
          });
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            !['OUTSIDE_SCHEDULE', 'SLOT_UNAVAILABLE'].includes(error.code)
          )
            throw error;
        }
      }
      return [...slots.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
    { timeout: 30000 },
  );
  return serviceResult({ slots: result }, { status: 200, format: 'json' });
}

export async function createAppointmentResource(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { serviceId, resourceId } = requestInput.body;
  const link = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${-vendorId}::integer,0::integer)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${resourceId}::integer)`;
    const [service, resource] = await Promise.all([
      tx.whalexyAppointmentServices.findFirst({ where: { id: serviceId, vendorId } }),
      tx.whalexyAppointmentResources.findFirst({ where: { id: resourceId, vendorId } }),
    ]);
    if (!service || !resource)
      throw new ApiError(404, 'NOT_FOUND', 'Service or resource not found');
    return tx.whalexyAppointmentServiceResources.upsert({
      where: {
        appointmentServiceId_appointmentResourceId: {
          appointmentServiceId: serviceId,
          appointmentResourceId: resourceId,
        },
      },
      create: {
        vendorId,
        appointmentServiceId: serviceId,
        appointmentResourceId: resourceId,
        capacity: 1,
      },
      update: {},
    });
  });
  return serviceResult(link, { status: 201, format: 'json' });
}

export async function holdAppointmentSlot(requestInput: ServiceContext) {
  const contactId = requestInput.body.contactId ?? null;
  if (contactId === null) {
    if (!can(requestInput, 'vendor.chats.view_all'))
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Contact-free reservations require full conversation access',
      );
  } else await visibleContact(requestInput, contactId);
  const vendorId = requestInput.identity!.vendorId!,
    { serviceId, resourceId, startsAt } = requestInput.body;
  const hold = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${resourceId}::integer)`;
      const { service, resource } = await getAppointmentResource(
        tx,
        vendorId,
        serviceId,
        resourceId,
      );
      const { claimStart, claimEnd } = await validateAppointmentSlot(
        tx,
        vendorId,
        service,
        resource,
        startsAt,
      );
      return tx.whalexyAppointmentHolds.create({
        data: {
          vendorId,
          contactId,
          appointmentServiceId: serviceId,
          appointmentResourceId: resourceId,
          startsAtUtc: claimStart,
          endsAtUtc: claimEnd,
          expiresAt: new Date(Date.now() + 5 * 60000),
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return serviceResult(
    { token: hold.token, expiresAt: hold.expiresAt },
    { status: 201, format: 'json' },
  );
}
