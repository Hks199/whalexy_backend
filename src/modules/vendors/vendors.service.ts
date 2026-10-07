import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { digest, opaqueToken } from '../../utils/crypto.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function listProjects(requestInput: ServiceContext) {
  const memberships = await db.nativeMemberships.findMany({
    where: { userId: requestInput.identity!.userId, active: true },
  });
  return serviceResult(
    await db.vendors.findMany({
      where: { id: { in: memberships.map((m) => m.vendorId) } },
      select: { id: true, uid: true, title: true, status: true },
    }),
    { status: 200, format: 'json' },
  );
}
export async function createProject(requestInput: ServiceContext) {
  const vendor = await db.$transaction(async (tx) => {
    const vendor = await tx.vendors.create({ data: { title: requestInput.body.title, status: 1 } });
    await tx.nativeMemberships.create({
      data: {
        vendorId: vendor.id,
        userId: requestInput.identity!.userId,
        role: 'owner',
        permissions: ['*'],
      },
    });
    await tx.vendorUsers.create({
      data: {
        vendorId: vendor.id,
        userId: requestInput.identity!.userId,
        status: 1,
        data: { permissions: ['*'] },
      },
    });
    return vendor;
  });
  return serviceResult(
    { id: vendor.id, uid: vendor.uid, title: vendor.title },
    { status: 201, format: 'json' },
  );
}
export async function selectProject(requestInput: ServiceContext) {
  const m = await db.nativeMemberships.findUnique({
    where: {
      vendorId_userId: {
        vendorId: Number(requestInput.params.id),
        userId: requestInput.identity!.userId,
      },
    },
  });
  if (!m?.active) throw new ApiError(403, 'FORBIDDEN', 'Business access denied');
  await db.users.update({
    where: { id: requestInput.identity!.userId },
    data: { currentVendorId: m.vendorId },
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function listTeamMembers(requestInput: ServiceContext) {
  const members = await db.nativeMemberships.findMany({
    where: { vendorId: requestInput.identity!.vendorId! },
  });
  const users = await db.users.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, name: true, email: true, status: true },
  });
  return serviceResult(
    members.map((m) => ({ ...m, user: users.find((u) => u.id === m.userId) })),
    { status: 200, format: 'json' },
  );
}
export async function inviteTeamMember(requestInput: ServiceContext) {
  if (requestInput.identity!.role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can grant team access');
  if (
    requestInput.body.permissions.some(
      (p: string) =>
        !requestInput.identity!.permissions.includes('*') &&
        !requestInput.identity!.permissions.includes(p),
    )
  )
    throw new ApiError(403, 'FORBIDDEN', 'Cannot grant unavailable permissions');
  const user = await db.users.findUnique({
    where: { id: requestInput.body.userId },
    select: { id: true, status: true },
  });
  if (user?.status !== 1) throw new ApiError(404, 'NOT_FOUND', 'Active user not found');
  const m = await db.nativeMemberships.create({
    data: {
      vendorId: requestInput.identity!.vendorId!,
      userId: user.id,
      role: 'agent',
      permissions: requestInput.body.permissions,
    },
  });
  return serviceResult(m, { status: 201, format: 'json' });
}
export async function updateTeamMember(requestInput: ServiceContext) {
  if (requestInput.identity!.role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can change team access');
  if (
    requestInput.body.permissions?.some(
      (p: string) =>
        !requestInput.identity!.permissions.includes('*') &&
        !requestInput.identity!.permissions.includes(p),
    )
  )
    throw new ApiError(403, 'FORBIDDEN', 'Cannot grant unavailable permissions');
  const m = await db.nativeMemberships.findFirst({
    where: { id: String(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
  });
  if (!m) throw new ApiError(404, 'NOT_FOUND', 'Membership not found');
  if (m.role === 'owner')
    throw new ApiError(
      409,
      'OWNER_PROTECTED',
      'Owner access cannot be changed through this endpoint',
    );
  return serviceResult(
    await db.nativeMemberships.update({ where: { id: m.id }, data: requestInput.body }),
    { status: 200, format: 'json' },
  );
}
export async function createApiKey(requestInput: ServiceContext) {
  if (
    requestInput.body.permissions.some(
      (p: string) =>
        !requestInput.identity!.permissions.includes('*') &&
        !requestInput.identity!.permissions.includes(p),
    )
  )
    throw new ApiError(403, 'FORBIDDEN', 'Cannot grant unavailable permissions');
  const token = opaqueToken();
  const record = await db.apiKeys.create({
    data: {
      vendorId: requestInput.identity!.vendorId!,
      userId: requestInput.identity!.userId,
      keyHash: digest(token),
      permissions: requestInput.body.permissions,
      expiresAt: requestInput.body.expiresAt,
    },
  });
  return serviceResult(
    { id: record.id, token, expiresAt: record.expiresAt },
    { status: 201, format: 'json' },
  );
}
export async function revokeApiKey(requestInput: ServiceContext) {
  const changed = await db.apiKeys.updateMany({
    where: { id: String(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
    data: { revokedAt: new Date() },
  });
  if (!changed.count) throw new ApiError(404, 'NOT_FOUND', 'API key not found');
  return serviceResult(undefined, { status: 204, format: 'end' });
}
