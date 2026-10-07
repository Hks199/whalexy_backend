import type { Prisma } from '@prisma/client';
import type { ServiceContext } from '../../../shared/service-context.js';
import { ApiError } from '../../../shared/api-error.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
export async function authorizeCampaign(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  permission: string,
) {
  const permissions = await currentContactPermissions(tx, input);
  const has = (p: string) => permissions.includes('*') || permissions.includes(p);
  if (!has(permission) || !has('vendor.chats.view_all'))
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Campaigns require current action permission and access to all customer chats',
    );
  return permissions;
}
