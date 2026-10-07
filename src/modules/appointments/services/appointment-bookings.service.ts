import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { visibleContact } from '../../contacts/contacts.service.js';
import { scheduleReminders } from '../../appointment-reminders/appointment-reminders.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { getAppointmentResource, validateAppointmentSlot } from './appointments-support.service.js';

export async function bookAppointment(requestInput: ServiceContext) {
  const contactId = requestInput.body.contactId ?? null;
  if (contactId === null && !can(requestInput, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact-free booking requires full conversation access');
  const contact = contactId === null ? null : await visibleContact(requestInput, contactId),
    vendorId = requestInput.identity!.vendorId!,
    { serviceId, resourceId, startsAt, idempotencyKey, holdToken, notes } = requestInput.body;
  const customerName = requestInput.body.customerName ?? contact?.firstName ?? null;
  const customerPhone = requestInput.body.customerPhone ?? contact?.waId ?? null;
  const customerEmail = requestInput.body.customerEmail ?? null;
  const booking = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${resourceId}::integer)`;
      const old = await tx.whalexyAppointments.findUnique({
        where: { vendorId_idempotencyKey: { vendorId, idempotencyKey } },
      });
      if (old) {
        if (
          old.contactId !== contactId ||
          old.appointmentServiceId !== serviceId ||
          old.appointmentResourceId !== resourceId ||
          old.startsAtUtc.getTime() !== startsAt.getTime() ||
          old.customerName !== customerName ||
          old.customerPhone !== customerPhone ||
          old.customerEmail !== customerEmail ||
          old.notes !== (notes ?? null) ||
          (requestInput.body.timezone !== undefined &&
            old.timezone !== requestInput.body.timezone) ||
          (requestInput.body.source !== undefined && old.source !== requestInput.body.source)
        )
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for another booking');
        return old;
      }
      const { service, resource } = await getAppointmentResource(
        tx,
        vendorId,
        serviceId,
        resourceId,
      );
      const hold = holdToken
        ? await tx.whalexyAppointmentHolds.findFirst({
            where: {
              vendorId,
              token: holdToken,
              contactId,
              appointmentServiceId: serviceId,
              appointmentResourceId: resourceId,
              convertedAt: null,
              expiresAt: { gt: new Date() },
            },
          })
        : null;
      if (
        holdToken &&
        (!hold ||
          hold.startsAtUtc.getTime() !== startsAt.getTime() - service.bufferBeforeMinutes * 60000)
      )
        throw new ApiError(409, 'INVALID_HOLD', 'Hold is unavailable or does not match');
      const { end, claimStart, claimEnd } = await validateAppointmentSlot(
        tx,
        vendorId,
        service,
        resource,
        startsAt,
        hold?.id,
      );
      const booking = await tx.whalexyAppointments.create({
        data: {
          vendorId,
          contactId,
          appointmentServiceId: serviceId,
          appointmentResourceId: resourceId,
          startsAtUtc: startsAt,
          endsAtUtc: end,
          timezone: requestInput.body.timezone ?? resource.timezone,
          source: requestInput.body.source ?? 'api',
          status: 'confirmed',
          idempotencyKey,
          notes,
          customerName,
          customerPhone,
          customerEmail,
          confirmedAt: new Date(),
        },
      });
      const claims = [];
      for (let ms = claimStart.getTime(); ms < claimEnd.getTime(); ms += 60000)
        claims.push({ vendorId, resourceId, appointmentId: booking.id, slot: new Date(ms) });
      await tx.nativeBookingClaims.createMany({ data: claims });
      if (hold)
        await tx.whalexyAppointmentHolds.update({
          where: { id: hold.id },
          data: { convertedAt: new Date() },
        });
      if (
        contactId !== null &&
        resource.userId &&
        resource.autoAssignChat &&
        (await tx.nativeMemberships.findFirst({
          where: { vendorId, userId: resource.userId, active: true },
        }))
      )
        await tx.contacts.updateMany({
          where: { id: contactId, vendorId },
          data: { assignedUserId: resource.userId, updatedAt: new Date() },
        });
      await scheduleReminders(tx, booking);
      return booking;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
  );
  return serviceResult(
    {
      id: booking.id,
      uid: booking.uid,
      status: booking.status,
      startsAt: booking.startsAtUtc,
      endsAt: booking.endsAtUtc,
    },
    { status: 201, format: 'json' },
  );
}

export async function getAppointment(requestInput: ServiceContext) {
  const booking = await db.whalexyAppointments.findFirst({
    where: { id: Number(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
  });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (booking.contactId) await visibleContact(requestInput, booking.contactId);
  else if (!can(requestInput, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Appointment access denied');
  return serviceResult(
    {
      id: booking.id,
      uid: booking.uid,
      status: booking.status,
      startsAt: booking.startsAtUtc,
      endsAt: booking.endsAtUtc,
      serviceId: booking.appointmentServiceId,
      resourceId: booking.appointmentResourceId,
    },
    { status: 200, format: 'json' },
  );
}

export async function cancelAppointment(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    booking = await db.whalexyAppointments.findFirst({
      where: { id: Number(requestInput.params.id), vendorId },
    });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
  if (booking.contactId) await visibleContact(requestInput, booking.contactId);
  else if (!can(requestInput, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Appointment access denied');
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${booking.appointmentResourceId}::integer)`;
    await tx.whalexyAppointments.update({
      where: { id: booking.id },
      data: { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() },
    });
    await tx.nativeBookingClaims.deleteMany({ where: { vendorId, appointmentId: booking.id } });
    await tx.whalexyAppointmentSlotClaims.deleteMany({
      where: { vendorId, appointmentId: booking.id },
    });
    await tx.whalexyAppointmentReminderDeliveries.updateMany({
      where: { vendorId, appointmentId: booking.id, status: 'pending' },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function rescheduleAppointment(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    startsAt: Date = requestInput.body.startsAt;
  const old = await db.whalexyAppointments.findFirst({ where: { id, vendorId } });
  if (!old) throw new ApiError(404, 'NOT_FOUND', 'Appointment not found');
  if (old.contactId) await visibleContact(requestInput, old.contactId);
  else if (!can(requestInput, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Appointment access denied');
  const updated = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${old.appointmentResourceId}::integer)`;
      const current = await tx.whalexyAppointments.findFirstOrThrow({ where: { id, vendorId } });
      if (current.status === 'cancelled')
        throw new ApiError(
          409,
          'APPOINTMENT_STATE',
          'Cancelled appointments cannot be rescheduled',
        );
      const { service, resource } = await getAppointmentResource(
        tx,
        vendorId,
        current.appointmentServiceId,
        current.appointmentResourceId,
      );
      const { end, claimStart, claimEnd } = await validateAppointmentSlot(
        tx,
        vendorId,
        service,
        resource,
        startsAt,
        undefined,
        id,
      );
      await tx.nativeBookingClaims.deleteMany({ where: { vendorId, appointmentId: id } });
      await tx.whalexyAppointmentSlotClaims.deleteMany({ where: { vendorId, appointmentId: id } });
      const claims = [];
      for (let ms = claimStart.getTime(); ms < claimEnd.getTime(); ms += 60000)
        claims.push({ vendorId, resourceId: resource.id, appointmentId: id, slot: new Date(ms) });
      await tx.nativeBookingClaims.createMany({ data: claims });
      await tx.whalexyAppointmentReminderDeliveries.updateMany({
        where: { vendorId, appointmentId: id, status: 'pending' },
        data: { status: 'cancelled', updatedAt: new Date() },
      });
      const updated = await tx.whalexyAppointments.update({
        where: { id },
        data: { startsAtUtc: startsAt, endsAtUtc: end, status: 'confirmed', updatedAt: new Date() },
      });
      await scheduleReminders(tx, updated);
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
  );
  return serviceResult(
    {
      id: updated.id,
      status: updated.status,
      startsAt: updated.startsAtUtc,
      endsAt: updated.endsAtUtc,
    },
    { status: 200, format: 'json' },
  );
}

export async function markAppointmentNoShow(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id),
    booking = await db.whalexyAppointments.findFirst({ where: { id, vendorId } });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Appointment not found');
  if (booking.contactId) await visibleContact(requestInput, booking.contactId);
  else if (!can(requestInput, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Appointment access denied');
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${booking.appointmentResourceId}::integer)`;
    const changed = await tx.whalexyAppointments.updateMany({
      where: { id, vendorId, status: { not: 'cancelled' } },
      data: { status: 'no_show', updatedAt: new Date() },
    });
    if (!changed.count)
      throw new ApiError(
        409,
        'APPOINTMENT_STATE',
        'Cancelled appointments cannot be marked no-show',
      );
    await tx.nativeBookingClaims.deleteMany({ where: { vendorId, appointmentId: id } });
    await tx.whalexyAppointmentSlotClaims.deleteMany({ where: { vendorId, appointmentId: id } });
    await tx.whalexyAppointmentReminderDeliveries.updateMany({
      where: { vendorId, appointmentId: id, status: 'pending' },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
