import type { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import type { ServiceContext } from '../../../shared/service-context.js';
export async function currentContactPermissions(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
) {
  const identity = input.identity!,
    vendorId = identity.vendorId!;
  const [membership, user, vendor] = await Promise.all([
    tx.nativeMemberships.findUnique({
      where: { vendorId_userId: { vendorId, userId: identity.userId } },
    }),
    tx.users.findFirst({ where: { id: identity.userId, status: 1 }, select: { id: true } }),
    tx.vendors.findFirst({ where: { id: vendorId, status: 1 }, select: { id: true } }),
  ]);
  if (!membership?.active || !Array.isArray(membership.permissions) || !user || !vendor)
    throw new ApiError(403, 'FORBIDDEN', 'Contact administration access changed');
  let permissions = membership.permissions;
  if (identity.apiKeyId) {
    const key = await tx.apiKeys.findFirst({
      where: {
        id: identity.apiKeyId,
        vendorId,
        userId: identity.userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!key || !Array.isArray(key.permissions))
      throw new ApiError(403, 'FORBIDDEN', 'API access changed');
    const keyPermissions = key.permissions;
    permissions = permissions.includes('*')
      ? keyPermissions
      : keyPermissions.includes('*')
        ? permissions
        : permissions.filter((p) => keyPermissions.includes(p));
  }
  return permissions;
}
export async function authorizeContactAdministration(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
) {
  const permissions = await currentContactPermissions(tx, input);
  if (
    !permissions.includes('*') &&
    (!permissions.includes('vendor.groups.manage') ||
      !permissions.includes('vendor.chats.view_all'))
  )
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Contact administration requires group management and full contact visibility',
    );
  return permissions;
}
