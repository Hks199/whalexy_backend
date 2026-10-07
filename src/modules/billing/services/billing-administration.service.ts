import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { reviewNativeManual } from '../../manual-billing/services/manual-billing-support.service.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';

export async function reviewManualSubscription(
  requestInput: ServiceContext,
  action: 'approve' | 'reject',
) {
  const row = await db.$transaction(async (tx) => {
    const id = Number(requestInput.params.id),
      vendorId = Number(requestInput.params.vendorId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-billing:${vendorId}`},0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-subscription:${id}`},0))`;
    const current = await tx.manualSubscriptions.findFirst({ where: { id, vendorId } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Manual subscription not found');
    if (current.status !== 'pending')
      throw new ApiError(
        409,
        'SUBSCRIPTION_STATE',
        'Only a pending manual subscription can be reviewed',
      );
    const reviewed = await reviewNativeManual(
      tx,
      { ...current, data: current.data as any },
      requestInput.identity!.userId,
      action,
      requestInput.body.endsAt,
    );
    const row = await tx.manualSubscriptions.update({
      where: { id },
      data: {
        status: action === 'approve' ? 'active' : 'rejected',
        ...(action === 'approve' ? { endsAt: reviewed.endsAt } : {}),
        data: {
          ...((current.data as Prisma.InputJsonObject) ?? {}),
          ...(reviewed.nativeManual
            ? { nativeManual: reviewed.nativeManual as unknown as Prisma.InputJsonValue }
            : {}),
          ...(reviewed.invoice ? { invoice: reviewed.invoice } : {}),
          reviewedBy: requestInput.identity!.userId,
          reviewedAt: new Date().toISOString(),
          ...(action === 'reject' ? { rejectionReason: requestInput.body.reason } : {}),
        },
        updatedAt: new Date(),
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action,
        resource: 'manual-subscription',
        resourceId: String(id),
      },
    });
    return row;
  });
  return serviceResult(
    { id: row.id, status: row.status, endsAt: row.endsAt },
    { status: 200, format: 'json' },
  );
}

export async function overrideAiReplyAllowance(requestInput: ServiceContext) {
  const vendorId = Number(requestInput.params.vendorId),
    row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-addon-override:${vendorId}`},0))`;
      await tx.subscriptionAddons.updateMany({
        where: { vendorId, addonCode: 'ai_replies', source: 'admin_override', status: 'active' },
        data: { status: 'suspended', disabledAt: new Date(), updatedAt: new Date() },
      });
      const row = await tx.subscriptionAddons.create({
        data: {
          vendorId,
          addonCode: 'ai_replies',
          source: 'admin_override',
          status: 'active',
          price: 0,
          startedAt: new Date(),
          expiresAt: requestInput.body.expiresAt,
          enabledBy: requestInput.identity!.userId,
          enabledAt: new Date(),
        },
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'enable',
          resource: 'ai-addon-override',
          resourceId: String(row.id),
        },
      });
      return row;
    });
  return serviceResult(
    { id: row.id, status: row.status, expiresAt: row.expiresAt },
    { status: 201, format: 'json' },
  );
}

export async function removeAiReplyOverride(requestInput: ServiceContext) {
  const vendorId = Number((requestInput.params as Record<string, string>).vendorId);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-addon-override:${vendorId}`},0))`;
    await tx.subscriptionAddons.updateMany({
      where: { vendorId, addonCode: 'ai_replies', source: 'admin_override', status: 'active' },
      data: { status: 'suspended', disabledAt: new Date(), updatedAt: new Date() },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'disable',
        resource: 'ai-addon-override',
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
