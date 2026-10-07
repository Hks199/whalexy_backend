import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';

const result = (data: unknown, status = 200) => serviceResult({ data }, { status, format: 'json' });
const empty = () => serviceResult(undefined, { status: 204, format: 'end' });

async function ownedResource(tx: Prisma.TransactionClient, vendorId: number, uid: string) {
  const resource = await tx.whalexyAppointmentResources.findFirst({ where: { vendorId, uid } });
  if (!resource) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
  return resource;
}
async function validateStaff(
  tx: Prisma.TransactionClient,
  vendorId: number,
  userId?: number | null,
) {
  if (!userId) return;
  const membership = await tx.nativeMemberships.findFirst({
    where: { vendorId, userId, active: true },
  });
  const user = await tx.users.findUnique({ where: { id: userId }, select: { status: true } });
  if (!membership || user?.status !== 1)
    throw new ApiError(422, 'INVALID_STAFF', 'Staff member must be active in this business');
}
async function lockResource(tx: Prisma.TransactionClient, vendorId: number, resourceId: number) {
  // Same lock as booking, so deleting/changing resources cannot race a booking.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${vendorId}::integer,${resourceId}::integer)`;
}
async function hasUpcomingBookings(
  tx: Prisma.TransactionClient,
  vendorId: number,
  where: Prisma.WhalexyAppointmentsWhereInput,
) {
  return tx.whalexyAppointments.count({
    where: { ...where, vendorId, status: 'confirmed', endsAtUtc: { gte: new Date() } },
  });
}

export async function listResources(input: ServiceContext) {
  return result(
    await db.whalexyAppointmentResources.findMany({
      where: { vendorId: input.identity!.vendorId! },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  );
}
export async function createResource(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  return result(
    await db.$transaction(async (tx) => {
      await validateStaff(tx, vendorId, input.body.userId);
      const { metadata, ...body } = input.body;
      return tx.whalexyAppointmentResources.create({
        data: { ...body, vendorId, metadata: metadata === null ? Prisma.DbNull : metadata },
      });
    }),
    201,
  );
}
export async function updateResource(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  return result(
    await db.$transaction(async (tx) => {
      const resource = await ownedResource(tx, vendorId, input.params.resourceUid);
      await lockResource(tx, vendorId, resource.id);
      await validateStaff(tx, vendorId, input.body.userId);
      const { metadata, ...body } = input.body;
      return tx.whalexyAppointmentResources.update({
        where: { id: resource.id },
        data: {
          ...body,
          metadata: metadata === null ? Prisma.DbNull : metadata,
          updatedAt: new Date(),
        },
      });
    }),
  );
}
export async function deleteResource(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    const resource = await ownedResource(tx, vendorId, input.params.resourceUid);
    await lockResource(tx, vendorId, resource.id);
    if (await hasUpcomingBookings(tx, vendorId, { appointmentResourceId: resource.id }))
      throw new ApiError(
        409,
        'ACTIVE_BOOKINGS',
        'Cancel upcoming appointments before deleting this resource',
      );
    if (
      await tx.whalexyAppointmentHolds.count({
        where: {
          vendorId,
          appointmentResourceId: resource.id,
          convertedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
    )
      throw new ApiError(409, 'ACTIVE_HOLDS', 'Resource has an unexpired reservation');
    await tx.whalexyAppointmentServiceResources.deleteMany({
      where: { vendorId, appointmentResourceId: resource.id },
    });
    await tx.whalexyAppointmentSchedules.deleteMany({
      where: { vendorId, appointmentResourceId: resource.id },
    });
    await tx.whalexyAppointmentScheduleExceptions.deleteMany({
      where: { vendorId, appointmentResourceId: resource.id },
    });
    await tx.whalexyAppointmentResources.delete({ where: { id: resource.id } });
  });
  return empty();
}

export async function listServices(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  const [services, links] = await Promise.all([
    db.whalexyAppointmentServices.findMany({
      where: { vendorId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    db.whalexyAppointmentServiceResources.findMany({ where: { vendorId }, orderBy: { id: 'asc' } }),
  ]);
  return result(
    services.map((service) => ({
      ...service,
      resources: links.filter((link) => link.appointmentServiceId === service.id),
    })),
  );
}
async function saveService(input: ServiceContext, update: boolean) {
  const vendorId = input.identity!.vendorId!;
  return result(
    await db.$transaction(async (tx) => {
      // Serializes service edits and deletion; resource locks serialize against bookings.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${-vendorId}::integer,0::integer)`;
      const existing = update
        ? await tx.whalexyAppointmentServices.findFirst({
            where: { vendorId, uid: input.params.serviceUid },
          })
        : null;
      if (update && !existing) throw new ApiError(404, 'NOT_FOUND', 'Service not found');
      const { resourceUids, ...body } = input.body;
      const resources = await tx.whalexyAppointmentResources.findMany({
        where: { vendorId, uid: { in: resourceUids } },
        orderBy: { id: 'asc' },
      });
      if (resources.length !== resourceUids.length)
        throw new ApiError(
          422,
          'INVALID_RESOURCE',
          'One or more resources do not belong to this business',
        );
      const oldLinks = existing
        ? await tx.whalexyAppointmentServiceResources.findMany({
            where: { vendorId, appointmentServiceId: existing.id },
          })
        : [];
      for (const id of [
        ...new Set([
          ...resources.map((r) => r.id),
          ...oldLinks.map((l) => l.appointmentResourceId),
        ]),
      ].sort((a, b) => a - b))
        await lockResource(tx, vendorId, id);
      // Re-read under the locks because a resource may have been deleted while waiting.
      if (
        (await tx.whalexyAppointmentResources.count({
          where: { vendorId, uid: { in: resourceUids } },
        })) !== resources.length
      )
        throw new ApiError(422, 'INVALID_RESOURCE', 'Resource is no longer available');
      const saved = existing
        ? await tx.whalexyAppointmentServices.update({
            where: { id: existing.id },
            data: { ...body, updatedAt: new Date() },
          })
        : await tx.whalexyAppointmentServices.create({ data: { ...body, vendorId } });
      await tx.whalexyAppointmentServiceResources.deleteMany({
        where: { vendorId, appointmentServiceId: saved.id },
      });
      await tx.whalexyAppointmentServiceResources.createMany({
        data: resources.map((r) => ({
          vendorId,
          appointmentServiceId: saved.id,
          appointmentResourceId: r.id,
          capacity: 1,
        })),
      });
      return saved;
    }),
    update ? 200 : 201,
  );
}
export async function createService(input: ServiceContext) {
  return saveService(input, false);
}
export async function updateService(input: ServiceContext) {
  return saveService(input, true);
}
export async function deleteAppointmentService(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${-vendorId}::integer,0::integer)`;
    const service = await tx.whalexyAppointmentServices.findFirst({
      where: { vendorId, uid: input.params.serviceUid },
    });
    if (!service) throw new ApiError(404, 'NOT_FOUND', 'Service not found');
    const links = await tx.whalexyAppointmentServiceResources.findMany({
      where: { vendorId, appointmentServiceId: service.id },
      orderBy: { appointmentResourceId: 'asc' },
    });
    for (const link of links) await lockResource(tx, vendorId, link.appointmentResourceId);
    if (await hasUpcomingBookings(tx, vendorId, { appointmentServiceId: service.id }))
      throw new ApiError(
        409,
        'ACTIVE_BOOKINGS',
        'Cancel upcoming appointments before deleting this service',
      );
    if (
      await tx.whalexyAppointmentHolds.count({
        where: {
          vendorId,
          appointmentServiceId: service.id,
          convertedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
    )
      throw new ApiError(409, 'ACTIVE_HOLDS', 'Service has an unexpired reservation');
    await tx.whalexyAppointmentServiceResources.deleteMany({
      where: { vendorId, appointmentServiceId: service.id },
    });
    await tx.whalexyAppointmentServices.delete({ where: { id: service.id } });
  });
  return empty();
}
export async function getResourceSchedule(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  const resource = await ownedResource(db, vendorId, input.params.resourceUid);
  return result(
    await db.whalexyAppointmentSchedules.findMany({
      where: { vendorId, appointmentResourceId: resource.id },
      orderBy: [{ weekday: 'asc' }, { startLocalTime: 'asc' }],
    }),
  );
}
export async function replaceResourceSchedule(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    const resource = await ownedResource(tx, vendorId, input.params.resourceUid);
    await lockResource(tx, vendorId, resource.id);
    await tx.whalexyAppointmentSchedules.deleteMany({
      where: { vendorId, appointmentResourceId: resource.id },
    });
    if (input.body.periods.length)
      await tx.whalexyAppointmentSchedules.createMany({
        data: input.body.periods.map(
          (period: {
            weekday: number;
            startLocalTime: string;
            endLocalTime: string;
            timezone: string;
          }) => ({ ...period, vendorId, appointmentResourceId: resource.id }),
        ),
      });
  });
  return serviceResult({ result: 'success' }, { status: 200, format: 'json' });
}
export async function listOffDuty(input: ServiceContext) {
  return result(
    await db.whalexyAppointmentScheduleExceptions.findMany({
      where: { vendorId: input.identity!.vendorId!, type: 'unavailable' },
      orderBy: { startsAtUtc: 'asc' },
    }),
  );
}
export async function createOffDuty(input: ServiceContext) {
  const vendorId = input.identity!.vendorId!,
    { resourceId, startsAt, endsAt, reason } = input.body;
  return result(
    await db.$transaction(async (tx) => {
      // Lock all resources for a business-wide exception, in booking lock order.
      const resources = await tx.whalexyAppointmentResources.findMany({
        where: { vendorId, ...(resourceId ? { id: resourceId } : {}) },
        orderBy: { id: 'asc' },
      });
      if (resourceId && !resources.length)
        throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      for (const resource of resources) await lockResource(tx, vendorId, resource.id);
      return tx.whalexyAppointmentScheduleExceptions.create({
        data: {
          vendorId,
          appointmentResourceId: resourceId,
          startsAtUtc: startsAt,
          endsAtUtc: endsAt,
          reason,
          type: 'unavailable',
        },
      });
    }),
    201,
  );
}
export async function deleteOffDuty(input: ServiceContext) {
  const removed = await db.whalexyAppointmentScheduleExceptions.deleteMany({
    where: {
      id: Number(input.params.exceptionId),
      vendorId: input.identity!.vendorId!,
      type: 'unavailable',
    },
  });
  if (!removed.count) throw new ApiError(404, 'NOT_FOUND', 'Off-duty period not found');
  return empty();
}
