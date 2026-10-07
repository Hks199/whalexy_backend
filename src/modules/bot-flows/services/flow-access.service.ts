import type { BotFlows, Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
export async function authorizeFlow(tx: Prisma.TransactionClient, input: ServiceContext) {
  const permissions = await currentContactPermissions(tx, input);
  if (!permissions.includes('*') && !permissions.includes('vendor.bot.manage'))
    throw new ApiError(403, 'FORBIDDEN', 'Current bot management permission required');
}
export async function assertNativeFlow(tx: Prisma.TransactionClient, flow: BotFlows) {
  const data = flow.data as any;
  if (
    data?.nativeGraphVersion !== 1 ||
    typeof data.phoneNumberId !== 'string' ||
    !/^\d{5,100}$/.test(data.phoneNumberId) ||
    Object.keys(data).some(
      (key) => !['nativeGraphVersion', 'phoneNumberId', 'graph'].includes(key),
    ) ||
    flow.whatsappFlowId ||
    flow.whatsappMetaData !== null ||
    !Array.isArray(flow.channels) ||
    flow.channels.length !== 1 ||
    flow.channels[0] !== 'whatsapp' ||
    (await tx.botReplies.count({ where: { botFlowsId: flow.id } }))
  )
    throw new ApiError(
      409,
      'LEGACY_GRAPH_PENDING',
      'Imported builder, channel or provider configuration requires reconciliation',
    );
  return data;
}
