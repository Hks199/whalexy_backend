import { DateTime } from 'luxon';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { serializeLegacyAppointmentRecord } from './legacy-appointment.service.js';
import {
  getAppointmentAvailability,
  holdAppointmentSlot,
} from './appointment-availability.service.js';
import {
  bookAppointment,
  getAppointment,
  cancelAppointment,
} from './appointment-bookings.service.js';

function legacyBookingResult(input: ServiceContext, record: Record<string, unknown>, status = 200) {
  const data = serializeLegacyAppointmentRecord(record);
  if ('customer_phone' in data && !can(input, 'vendor.contacts.view_phone')) {
    data.customer_phone =
      typeof data.customer_phone === 'string' ? '***' + data.customer_phone.slice(-4) : null;
    data.customer_email = null;
  }
  return serviceResult({ data }, { status, format: 'json' });
}
async function resolveSlot(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  const [service, resource] = await Promise.all([
    db.whalexyAppointmentServices.findFirst({
      where: { vendorId, uid: input.body.service_uid, status: 'active' },
    }),
    db.whalexyAppointmentResources.findFirst({
      where: { vendorId, uid: input.body.resource_uid, status: 'active' },
    }),
  ]);
  if (!service || !resource) throw new ApiError(404, 'NOT_FOUND', 'Service or resource not found');
  const startsAt = DateTime.fromISO(input.body.starts_at, { zone: input.body.timezone });
  if (!startsAt.isValid || startsAt.toMillis() <= Date.now())
    throw new ApiError(422, 'INVALID_DATE', 'Invalid appointment date');
  return {
    ...input,
    body: {
      serviceId: service.id,
      resourceId: resource.id,
      contactId: input.body.contact_id ?? null,
      startsAt: startsAt.toJSDate(),
      timezone: input.body.timezone,
      idempotencyKey: input.body.idempotency_key,
      holdToken: input.body.hold_token,
      source: input.body.source,
      customerName: input.body.customer_name,
      customerPhone: input.body.customer_phone,
      customerEmail: input.body.customer_email,
      notes: input.body.notes,
    },
  };
}
async function ownedBooking(input: ServiceContext) {
  const booking = await db.whalexyAppointments.findFirst({
    where: { vendorId: input.identity!.vendorId!, uid: input.params.appointmentUid },
  });
  if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Appointment not found');
  return booking;
}
export async function getLegacyAppointmentAvailability(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!,
    query = input.validatedQuery;
  const service = await db.whalexyAppointmentServices.findFirst({
    where: { vendorId, uid: query.service_uid, status: 'active' },
  });
  if (!service) throw new ApiError(404, 'NOT_FOUND', 'Service not found');
  const date = DateTime.fromISO(query.date, { zone: query.timezone ?? service.timezone });
  if (!date.isValid) throw new ApiError(422, 'INVALID_DATE', 'Invalid availability date');
  const links = await db.whalexyAppointmentServiceResources.findMany({
    where: { vendorId, appointmentServiceId: service.id },
  });
  let selectedId: number | undefined;
  if (query.resource_uid) {
    const selected = await db.whalexyAppointmentResources.findFirst({
      where: { vendorId, uid: query.resource_uid, status: 'active' },
    });
    if (!selected) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    selectedId = selected.id;
  }
  const resources = await db.whalexyAppointmentResources.findMany({
    where: {
      vendorId,
      status: 'active',
      id: { in: links.map((link) => link.appointmentResourceId) },
      ...(selectedId ? { uid: query.resource_uid } : {}),
    },
    orderBy: { id: 'asc' },
    take: 101,
  });
  if (resources.length > 100)
    throw new ApiError(409, 'RESOURCE_LIMIT', 'Select a resource for availability');
  const slots: Record<string, unknown>[] = [];
  for (const resource of resources) {
    const result = await getAppointmentAvailability({
      ...input,
      validatedQuery: { serviceId: service.id, resourceId: resource.id, date: query.date },
    });
    for (const slot of (
      result.body as {
        slots: { startsAt: string; endsAt: string; startsAtLocal: string; timezone: string }[];
      }
    ).slots) {
      slots.push({
        resource_uid: resource.uid,
        resource_name: resource.name,
        starts_at_utc: slot.startsAt,
        ends_at_utc: slot.endsAt,
        starts_at_local: slot.startsAtLocal,
        timezone: slot.timezone,
      });
    }
  }
  slots.sort((a, b) => String(a.starts_at_utc).localeCompare(String(b.starts_at_utc)));
  return serviceResult({ data: slots }, { status: 200, format: 'json' });
}
export async function holdLegacyAppointmentSlot(input: ServiceContext) {
  const resolved = await resolveSlot(input);
  const result = await holdAppointmentSlot(resolved);
  const token = (result.body as { token: string }).token;
  const hold = await db.whalexyAppointmentHolds.findFirst({
    where: { token, vendorId: input.identity!.vendorId! },
  });
  if (!hold) throw new ApiError(409, 'HOLD_STATE', 'Reservation could not be read');
  return legacyBookingResult(input, hold, 201);
}
export async function bookLegacyAppointment(input: ServiceContext) {
  const result = await bookAppointment(await resolveSlot(input));
  const id = (result.body as { id: number }).id;
  const booking = await db.whalexyAppointments.findFirstOrThrow({
    where: { id, vendorId: input.identity!.vendorId! },
  });
  return legacyBookingResult(input, booking, 201);
}
export async function getLegacyAppointment(input: ServiceContext) {
  const booking = await ownedBooking(input);
  await getAppointment({ ...input, params: { ...input.params, id: booking.id } });
  return legacyBookingResult(input, booking);
}
export async function cancelLegacyAppointment(input: ServiceContext) {
  const booking = await ownedBooking(input);
  await cancelAppointment({ ...input, params: { ...input.params, id: booking.id } });
  const updated = await db.whalexyAppointments.findFirstOrThrow({
    where: { id: booking.id, vendorId: input.identity!.vendorId! },
  });
  return legacyBookingResult(input, updated);
}
