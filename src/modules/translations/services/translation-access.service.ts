import type { Prisma } from '@prisma/client';
import type { ServiceContext } from '../../../shared/service-context.js';
import { ApiError } from '../../../shared/api-error.js';
export async function authorizeTranslations(tx: Prisma.TransactionClient, input: ServiceContext) {
  const identity = input.identity!;
  const user = await tx.users.findFirst({
    where: { id: identity.userId, status: 1, userRolesId: 1 },
    select: { id: true },
  });
  if (!user || identity.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Current site administrator access required');
}
