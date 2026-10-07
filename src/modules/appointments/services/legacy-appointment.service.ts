import {
  serviceResult,
  type ServiceContext,
  type ServiceResult,
} from '../../../shared/service-context.js';
import * as management from './appointment-management.service.js';
import { Prisma } from '@prisma/client';

const fields: Record<string, string> = {
  id: '_id',
  uid: '_uid',
  vendorId: 'vendors__id',
  userId: 'users__id',
  autoAssignChat: 'auto_assign_chat',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  durationMinutes: 'duration_minutes',
  bufferBeforeMinutes: 'buffer_before_minutes',
  bufferAfterMinutes: 'buffer_after_minutes',
  contactId: 'contacts__id',
  appointmentServiceId: 'appointment_service_id',
  appointmentResourceId: 'appointment_resource_id',
  startsAtUtc: 'starts_at_utc',
  endsAtUtc: 'ends_at_utc',
  expiresAt: 'expires_at',
  convertedAt: 'converted_at',
  idempotencyKey: 'idempotency_key',
  customerName: 'customer_name',
  customerPhone: 'customer_phone',
  customerEmail: 'customer_email',
  externalReference: 'external_reference',
  confirmedAt: 'confirmed_at',
  cancelledAt: 'cancelled_at',
};
export function serializeLegacyAppointmentRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== 'resources')
      .map(([key, value]) => [
        fields[key] ?? key,
        key === 'price' && value !== null && value !== undefined
          ? new Prisma.Decimal(String(value)).toFixed(2)
          : value,
      ]),
  );
}
function legacyResult(result: ServiceResult) {
  const data = (result.body as { data: Record<string, unknown> | Record<string, unknown>[] }).data;
  return serviceResult(
    {
      data: Array.isArray(data)
        ? data.map(serializeLegacyAppointmentRecord)
        : serializeLegacyAppointmentRecord(data),
    },
    { status: result.status, format: 'json' },
  );
}
export async function listLegacyAppointmentResources(input: ServiceContext) {
  return legacyResult(await management.listResources(input));
}
export async function createLegacyAppointmentResource(input: ServiceContext) {
  return legacyResult(await management.createResource(input));
}
export async function listLegacyAppointmentServices(input: ServiceContext) {
  return legacyResult(await management.listServices(input));
}
export async function createLegacyAppointmentService(input: ServiceContext) {
  return legacyResult(await management.createService(input));
}
export async function replaceLegacyAppointmentSchedule(input: ServiceContext) {
  return management.replaceResourceSchedule(input);
}
