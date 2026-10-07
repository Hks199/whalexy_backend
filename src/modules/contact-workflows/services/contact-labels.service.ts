import { authorizeContactAdministration } from './contact-administration.service.js';
import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';

export async function lockContactLabels(tx: Prisma.TransactionClient, vendorId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact-labels:${vendorId}`}, 0))`;
}
export const labelProjection = {
  id: true,
  uid: true,
  title: true,
  textColor: true,
  bgColor: true,
  color: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};
export type LabelChanges = {
  title?: string;
  textColor?: string | null;
  bgColor?: string | null;
  color?: string | null;
  status?: number;
};
async function available(
  tx: Prisma.TransactionClient,
  vendorId: number,
  title: string,
  id?: number,
) {
  if (
    await tx.labels.findFirst({
      where: { vendorId, title, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    })
  )
    throw new ApiError(409, 'LABEL_TITLE_CONFLICT', 'Label title already exists');
}
export async function createContactLabel(
  input: ServiceContext,
  changes: LabelChanges & { title: string },
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(async (tx) => {
    await lockContactLabels(tx, vendorId);
    await authorizeContactAdministration(tx, input);
    await available(tx, vendorId, changes.title);
    const row = await tx.labels.create({
      data: { ...changes, vendorId, status: changes.status ?? 1 },
      select: labelProjection,
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: input.identity!.userId,
        action: 'create',
        resource: 'Labels',
        resourceId: String(row.id),
      },
    });
    return row;
  });
}
export async function updateContactLabel(
  input: ServiceContext,
  identifier: number | string,
  changes: LabelChanges,
) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(async (tx) => {
    await lockContactLabels(tx, vendorId);
    await authorizeContactAdministration(tx, input);
    const row = await tx.labels.findFirst({
      where: {
        vendorId,
        ...(typeof identifier === 'number' ? { id: identifier } : { uid: identifier }),
      },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Label not found');
    if (changes.title !== undefined) await available(tx, vendorId, changes.title, row.id);
    const updated = await tx.labels.update({
      where: { id: row.id },
      data: { ...changes, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) },
      select: labelProjection,
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: input.identity!.userId,
        action: 'update',
        resource: 'Labels',
        resourceId: String(row.id),
        metadata: { changedFields: Object.keys(changes) },
      },
    });
    return updated;
  });
}
export async function deleteContactLabel(input: ServiceContext, uid: string) {
  const vendorId = input.identity!.vendorId!;
  return db.$transaction(async (tx) => {
    await lockContactLabels(tx, vendorId);
    await authorizeContactAdministration(tx, input);
    const row = await tx.labels.findFirst({ where: { vendorId, uid } });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Label not found');
    if (
      await tx.contactLabels.findFirst({
        where: { labelsId: row.id, refContactId: { vendorId: { not: vendorId } } },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'LABEL_SCOPE_PENDING',
        'Reconcile cross-business imported label links before deletion',
      );
    const removed = await tx.contactLabels.deleteMany({ where: { labelsId: row.id } });
    await tx.labels.delete({ where: { id: row.id } });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: input.identity!.userId,
        action: 'delete',
        resource: 'Labels',
        resourceId: String(row.id),
        metadata: { removedAssignments: removed.count },
      },
    });
    return row.uid;
  });
}
