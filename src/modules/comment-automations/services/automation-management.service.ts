import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  presentRule,
  safeExecutionErrors,
  validateAccount,
  buildAutomationData,
  retainAutomationProof,
  lockCommentAutomation,
} from './comment-automations-support.service.js';

export async function listCommentAutomations(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { page, limit } = requestInput.validatedQuery,
    [items, total] = await Promise.all([
      db.commentToDmAutomations.findMany({
        where: { vendorId, deletedAt: null },
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.commentToDmAutomations.count({ where: { vendorId, deletedAt: null } }),
    ]);
  return serviceResult(
    { items: items.map(presentRule), total, page, limit },
    { status: 200, format: 'json' },
  );
}

export async function listAutomationExecutions(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { page, limit } = requestInput.validatedQuery,
    [items, total] = await Promise.all([
      db.commentToDmExecutions.findMany({
        where: { vendorId },
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.commentToDmExecutions.count({ where: { vendorId } }),
    ]);
  return serviceResult(
    {
      items: items.map((row) => ({
        ...row,
        error: row.error
          ? safeExecutionErrors.has(row.error)
            ? row.error
            : 'EXECUTION_REVIEW_REQUIRED'
          : null,
      })),
      total,
      page,
      limit,
    },
    { status: 200, format: 'json' },
  );
}

export async function createCommentAutomation(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    account = await validateAccount(vendorId, requestInput.body),
    row = await db.$transaction(async (tx) => {
      const row = await tx.commentToDmAutomations.create({
        data: {
          vendorId,
          createdBy: requestInput.identity!.userId,
          ...buildAutomationData(requestInput.body),
        },
      });
      await retainAutomationProof(tx, row, account, requestInput.identity!.userId);
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'create',
          resource: 'comment-automation',
          resourceId: row.uuid,
        },
      });
      return row;
    });
  return serviceResult(row, { status: 201, format: 'json' });
}

export async function getCommentAutomation(requestInput: ServiceContext) {
  const row = await db.commentToDmAutomations.findFirst({
    where: {
      id: Number(requestInput.params.id),
      vendorId: requestInput.identity!.vendorId!,
      deletedAt: null,
    },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
  return serviceResult(presentRule(row), { status: 200, format: 'json' });
}

export async function updateCommentAutomation(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    account = await validateAccount(vendorId, requestInput.body),
    id = Number(requestInput.params.id),
    row = await db.$transaction(async (tx) => {
      await lockCommentAutomation(tx, `comment-rule:${id}`);
      const old = await tx.commentToDmAutomations.findFirst({
        where: { id, vendorId, deletedAt: null },
      });
      if (!old) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
      const row = await tx.commentToDmAutomations.update({
        where: { id },
        data: {
          ...buildAutomationData(requestInput.body),
          createdBy: requestInput.identity!.userId,
          updatedAt: new Date(),
        },
      });
      await retainAutomationProof(tx, row, account, requestInput.identity!.userId);
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'update',
          resource: 'comment-automation',
          resourceId: row.uuid,
        },
      });
      return row;
    });
  return serviceResult(row, { status: 200, format: 'json' });
}

export async function deleteCommentAutomation(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id);
  await db.$transaction(async (tx) => {
    await lockCommentAutomation(tx, `comment-rule:${id}`);
    const row = await tx.commentToDmAutomations.findFirst({
      where: { id, vendorId, deletedAt: null },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
    await tx.commentToDmAutomations.update({
      where: { id },
      data: { status: 'deleted', deletedAt: new Date(), updatedAt: new Date() },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'delete',
        resource: 'comment-automation',
        resourceId: row.uuid,
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
