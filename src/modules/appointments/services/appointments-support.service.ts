import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { ApiError } from '../../../shared/api-error.js';

export function toLocalAppointmentTime(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const getDatePart = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(getDatePart('weekday')) + 1,
    time: `${getDatePart('hour')}:${getDatePart('minute')}:00`,
  };
}

export async function getAppointmentResource(
  tx: Prisma.TransactionClient,
  vendorId: number,
  serviceId: number,
  resourceId: number,
) {
  const [service, resource, link] = await Promise.all([
    tx.whalexyAppointmentServices.findFirst({
      where: { id: serviceId, vendorId, status: 'active' },
    }),
    tx.whalexyAppointmentResources.findFirst({
      where: { id: resourceId, vendorId, status: 'active' },
    }),
    tx.whalexyAppointmentServiceResources.findFirst({
      where: { vendorId, appointmentServiceId: serviceId, appointmentResourceId: resourceId },
    }),
  ]);
  if (!service || !resource || !link)
    throw new ApiError(404, 'NOT_FOUND', 'Available service/resource relationship not found');
  if (link.capacity !== 1)
    throw new ApiError(
      409,
      'UNSUPPORTED_CAPACITY',
      'Multiple-capacity resources require a verified booking policy',
    );
  if (
    service.durationMinutes < 5 ||
    service.durationMinutes > 1440 ||
    service.bufferBeforeMinutes < 0 ||
    service.bufferAfterMinutes < 0 ||
    service.bufferBeforeMinutes > 240 ||
    service.bufferAfterMinutes > 240
  )
    throw new ApiError(400, 'INVALID_DURATION', 'Unsupported booking duration');
  try {
    toLocalAppointmentTime(new Date(), resource.timezone);
  } catch {
    throw new ApiError(400, 'INVALID_TIMEZONE', 'Invalid resource timezone');
  }
  return { service, resource };
}

export function isWithinWorkingHours(schedules: any[], resource: any, start: Date, end: Date) {
  const local = DateTime.fromJSDate(start, { zone: resource.timezone }),
    localEnd = DateTime.fromJSDate(end, { zone: resource.timezone });
  if (!local.isValid || local.toISODate() !== localEnd.toISODate()) return false;
  const day = local.toISODate()!;
  return schedules.some((s) => {
    if (
      s.weekday !== local.weekday ||
      (s.effectiveFrom && s.effectiveFrom.toISOString().slice(0, 10) > day) ||
      (s.effectiveUntil && s.effectiveUntil.toISOString().slice(0, 10) < day)
    )
      return false;
    const from = DateTime.fromISO(`${day}T${s.startLocalTime}`, {
      zone: s.timezone || resource.timezone,
    });
    const until = DateTime.fromISO(`${day}T${s.endLocalTime}`, {
      zone: s.timezone || resource.timezone,
    });
    return from.isValid && until.isValid && local >= from && localEnd <= until;
  });
}

export async function validateAppointmentSlot(
  tx: Prisma.TransactionClient,
  vendorId: number,
  service: any,
  resource: any,
  start: Date,
  excludeHold?: number,
  excludeBooking?: number,
) {
  if (start.getSeconds() !== 0 || start.getMilliseconds() !== 0)
    throw new ApiError(400, 'INVALID_SLOT', 'Bookings must start on a whole minute');
  const end = new Date(start.getTime() + service.durationMinutes * 60000);
  const claimStart = new Date(start.getTime() - service.bufferBeforeMinutes * 60000),
    claimEnd = new Date(end.getTime() + service.bufferAfterMinutes * 60000);
  const schedules = await tx.whalexyAppointmentSchedules.findMany({
    where: { vendorId, appointmentResourceId: resource.id },
  });
  if (!isWithinWorkingHours(schedules, resource, start, end))
    throw new ApiError(409, 'OUTSIDE_SCHEDULE', 'Slot is outside resource availability');
  const automation = await tx.whalexyAppointmentAutomationSettings.findUnique({
    where: { vendorId },
  });
  if (automation?.systemEnabled === false)
    throw new ApiError(409, 'BOOKING_DISABLED', 'Appointment booking is disabled');
  const legacyStart = new Date(Math.floor(claimStart.getTime() / 300000) * 300000);
  const [exception, claim, hold, appointment, legacyClaim] = await Promise.all([
    tx.whalexyAppointmentScheduleExceptions.findFirst({
      where: {
        vendorId,
        appointmentResourceId: { in: [resource.id, 0] },
        type: 'unavailable',
        startsAtUtc: { lt: claimEnd },
        endsAtUtc: { gt: claimStart },
      },
    }),
    tx.nativeBookingClaims.findFirst({
      where: {
        vendorId,
        resourceId: resource.id,
        slot: { gte: claimStart, lt: claimEnd },
        ...(excludeBooking ? { appointmentId: { not: excludeBooking } } : {}),
      },
    }),
    tx.whalexyAppointmentHolds.findFirst({
      where: {
        vendorId,
        appointmentResourceId: resource.id,
        convertedAt: null,
        expiresAt: { gt: new Date() },
        startsAtUtc: { lt: claimEnd },
        endsAtUtc: { gt: claimStart },
        ...(excludeHold ? { id: { not: excludeHold } } : {}),
      },
    }),
    tx.whalexyAppointments.findFirst({
      where: {
        vendorId,
        appointmentResourceId: resource.id,
        status: { in: ['pending', 'confirmed'] },
        startsAtUtc: { lt: claimEnd },
        endsAtUtc: { gt: claimStart },
        ...(excludeBooking ? { id: { not: excludeBooking } } : {}),
      },
    }),
    tx.whalexyAppointmentSlotClaims.findFirst({
      where: {
        vendorId,
        appointmentResourceId: resource.id,
        slotStartUtc: { gte: legacyStart, lt: claimEnd },
        ...(excludeBooking ? { appointmentId: { not: excludeBooking } } : {}),
      },
    }),
  ]);
  if (exception || claim || hold || appointment || legacyClaim)
    throw new ApiError(409, 'SLOT_UNAVAILABLE', 'Slot is no longer available');
  return { end, claimStart, claimEnd };
}
