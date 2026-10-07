import type { Prisma } from '@prisma/client';
import type { ServiceContext } from '../../../shared/service-context.js';
import { ApiError } from '../../../shared/api-error.js';
export async function authorizePages(tx: Prisma.TransactionClient, input: ServiceContext) {
  const identity = input.identity!;
  if (
    identity.apiKeyId ||
    !(await tx.users.findFirst({
      where: { id: identity.userId, userRolesId: 1, status: 1 },
      select: { id: true },
    }))
  )
    throw new ApiError(403, 'FORBIDDEN', 'Current site administrator access required');
}
export async function ownedSitePage(tx: Prisma.TransactionClient, id: number) {
  const row = await tx.pages.findFirst({ where: { id, vendorId: null } });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Page not found');
  return row;
}
