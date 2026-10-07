import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { lockCampaign } from './campaigns-support.service.js';
import { authorizeCampaign } from './campaign-access.service.js';
export async function deleteCampaignTransaction(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
) {
  await authorizeCampaign(tx, input, 'vendor.campaigns.delete');
  const c = await lockCampaign(tx, input.identity!.vendorId!, Number(input.params.id));
  if (!['awaiting_test', 'draft', 'cancelled', 'blocked'].includes(c.status))
    throw new ApiError(409, 'CAMPAIGN_STATE', 'Stop the campaign before deletion');
  const [queue, logs, jobs] = await Promise.all([
    tx.whatsappMessageQueue.count({ where: { campaignId: c.id } }),
    tx.whatsappMessageLogs.count({
      where: { OR: [{ campaignId: c.id }, { data: { path: ['campaignTestId'], equals: c.id } }] },
    }),
    tx.outboxJobs.count({
      where: {
        OR: [
          { payload: { path: ['campaignId'], equals: c.id } },
          { payload: { path: ['campaignTestId'], equals: c.id } },
        ],
      },
    }),
  ]);
  if (queue || logs || jobs)
    throw new ApiError(
      409,
      'CAMPAIGN_HISTORY',
      'Preserve campaigns with queue, delivery or provider-job history',
    );
  await tx.auditEvents.create({
    data: {
      vendorId: c.vendorId,
      actorId: input.identity!.userId,
      action: 'delete',
      resource: 'campaign',
      resourceId: String(c.id),
      metadata: { uid: c.uid },
    },
  });
  await tx.campaigns.delete({ where: { id: c.id } });
}
export async function deleteCampaign(input: ServiceContext) {
  await db.$transaction((tx) => deleteCampaignTransaction(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 15000,
  });
  return serviceResult(undefined, { status: 204, format: 'empty' });
}
