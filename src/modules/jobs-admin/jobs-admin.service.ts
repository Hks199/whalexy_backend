import Joi from 'joi';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { commentJobRetryAllowed } from '../comment-automations/services/automation-recovery.service.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function listJobs(requestInput: ServiceContext, central: boolean) {
  const q = requestInput.validatedQuery,
    where = {
      ...(!central ? { vendorId: requestInput.identity!.vendorId! } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
  const [items, total] = await Promise.all([
    db.outboxJobs.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true,
        vendorId: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        availableAt: true,
        lockedAt: true,
      },
    }),
    db.outboxJobs.count({ where }),
  ]);
  return serviceResult(
    { items, total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}
export async function retryJob(requestInput: ServiceContext, central: boolean) {
  const id = String(requestInput.params.id);
  if (!Joi.string().uuid().validate(id).error) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`outbox-retry:${id}`},0))`;
      const row = await tx.outboxJobs.findFirst({
        where: { id, ...(!central ? { vendorId: requestInput.identity!.vendorId! } : {}) },
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
      if (!['blocked', 'failed', 'uncertain'].includes(row.status))
        throw new ApiError(409, 'JOB_STATE', 'Only unavailable jobs can be retried');
      const internal = [
        'webhook-shopify',
        'webhook-woocommerce',
        'webhook-stripe',
        'webhook-razorpay',
        'webhook-meta',
        'store-notification',
      ];
      if (row.kind === 'conversation-analysis') {
        const receipt = await tx.webhookReceipts.findUnique({
          where: { eventKey: `conversation-analysis:${id}` },
        });
        if (!['prepared', 'completed'].includes((receipt?.payload as any)?.status))
          throw new ApiError(
            409,
            'PROVIDER_RECONCILIATION_REQUIRED',
            'Reconcile a claimed analysis before retrying',
          );
      } else if (['comment-action', 'comment-follow'].includes(row.kind)) {
        if (!(await commentJobRetryAllowed(row)))
          throw new ApiError(
            409,
            'PROVIDER_RECONCILIATION_REQUIRED',
            'Reconcile the claimed comment effect before retrying',
          );
      } else if (!internal.includes(row.kind)) {
        if (!['whatsapp-send', 'email'].includes(row.kind))
          throw new ApiError(
            409,
            'JOB_HANDLER_PENDING',
            'Job does not have a supported retry handler',
          );
        if (row.status === 'uncertain' || row.lastError === 'WORKER_INTERRUPTED')
          throw new ApiError(
            409,
            'PROVIDER_RECONCILIATION_REQUIRED',
            'Reconcile the uncertain provider effect before retrying',
          );
        if (
          row.kind === 'whatsapp-send' &&
          row.status === 'failed' &&
          ![
            'PROVIDER_REJECTED',
            'INTEGRATION_NOT_CONFIGURED',
            'TEMPLATE_REQUIRED',
            'BUSINESS_INACTIVE',
            'SENDER_ACCESS_REVOKED',
          ].includes(row.lastError ?? '')
        )
          throw new ApiError(
            409,
            'PROVIDER_RECONCILIATION_REQUIRED',
            'The failed request does not establish whether the provider accepted it',
          );
      }
      const changed = await tx.outboxJobs.updateMany({
        where: { id, status: row.status },
        data: {
          status: 'pending',
          attempts: 0,
          lastError: null,
          lockedAt: null,
          availableAt: new Date(),
        },
      });
      if (!changed.count) throw new ApiError(409, 'JOB_STATE', 'Job state changed during retry');
      await tx.auditEvents.create({
        data: {
          vendorId: row.vendorId,
          actorId: requestInput.identity!.userId,
          action: 'retry',
          resource: 'outbox-job',
          resourceId: id,
        },
      });
    });
    return serviceResult({ status: 'pending' }, { status: 202, format: 'json' });
    return;
  }
  throw new ApiError(400, 'INVALID_ID', 'Invalid job identifier');
}
