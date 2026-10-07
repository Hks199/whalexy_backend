import {
  requireRegistrationOpen,
  lockSiteSettings,
} from '../configuration/services/site-settings.js';
import { randomUUID, randomInt, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { config } from '../../config/environment.js';
import { ApiError } from '../../shared/api-error.js';
import { opaqueToken, digest, encrypt, constantEqual } from '../../utils/crypto.js';
import { accessToken } from '../../security/tokens.js';
import { twilioVerify } from '../../infrastructure/providers/meta.client.js';
import { hashPassword, verifyPassword } from '../../utils/passwords.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export const dummyHash = hashPassword('not-a-real-user-password');
export const codeHash = (challengeId: string, code: string) =>
  createHmac('sha256', config.JWT_SECRET)
    .update(challengeId + ':' + code)
    .digest('hex');
export async function issueChallenge(
  userId: number,
  kind: 'email' | 'password-reset',
  options: {
    cooldownSeconds?: number;
    expectedPassword?: string;
  } = {},
) {
  const id = randomUUID(),
    code = kind === 'email' ? String(randomInt(100000, 1000000)) : opaqueToken();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(613, ${userId}::integer)`;
    if (options.expectedPassword) {
      const guarded = await tx.users.updateMany({
        where: { id: userId, password: options.expectedPassword, status: 1 },
        data: { updatedAt: new Date() },
      });
      if (!guarded.count)
        throw new ApiError(
          401,
          'INVALID_CREDENTIALS',
          'Account credentials changed; retry verification',
        );
    }
    const user = await tx.users.findUniqueOrThrow({ where: { id: userId } });
    if (options.expectedPassword && user.emailVerifiedAt && user.phoneVerifiedAt)
      throw new ApiError(409, 'ALREADY_VERIFIED', 'Email and phone are already verified');
    if (options.cooldownSeconds) {
      const latest = await tx.verificationChallenges.findFirst({
        where: { userId, kind },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.createdAt.getTime() > Date.now() - options.cooldownSeconds * 1000)
        throw new ApiError(
          429,
          'VERIFICATION_COOLDOWN',
          'Wait before requesting another verification code',
        );
    }
    await tx.verificationChallenges.updateMany({
      where: { userId, kind },
      data: { consumedAt: new Date(), codeHash: '' },
    });
    await tx.verificationChallenges.create({
      data: {
        id,
        userId,
        kind,
        codeHash: codeHash(id, code),
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    await tx.outboxJobs.create({
      data: {
        kind: 'email',
        payload: {
          challengeId: id,
          envelope: encrypt(JSON.stringify({ to: user.email, kind, challengeId: id, code })),
        },
      },
    });
  });
  return id;
}
export async function issueSession(
  tx: Prisma.TransactionClient,
  userId: number,
  familyId = randomUUID(),
) {
  const refreshToken = opaqueToken();
  const session = await tx.authSessions.create({
    data: {
      userId,
      familyId,
      tokenHash: digest(refreshToken),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  return { accessToken: await accessToken(userId, session.id), refreshToken, expiresIn: 900 };
}
export async function verifiedPendingUser(challengeId: string, emailCode: string) {
  const c = await db.verificationChallenges.findUnique({ where: { id: challengeId } });
  if (
    !c ||
    c.kind !== 'email' ||
    !c.consumedAt ||
    c.expiresAt <= new Date() ||
    !constantEqual(c.codeHash, codeHash(c.id, emailCode))
  )
    throw new ApiError(401, 'INVALID_VERIFICATION', 'Valid email verification proof required');
  const user = await db.users.findUniqueOrThrow({ where: { id: c.userId } });
  if (!user.emailVerifiedAt || !user.phoneNumber || user.status !== 1)
    throw new ApiError(401, 'INVALID_VERIFICATION', 'Account is not available for verification');
  return user;
}
export async function register(requestInput: ServiceContext) {
  const { name, email, password, phoneNumber, businessName } = requestInput.body;
  await requireRegistrationOpen();
  const hashed = await hashPassword(password);
  const result = await db.$transaction(async (tx) => {
    await lockSiteSettings(tx);
    await requireRegistrationOpen(tx);
    const vendor = await tx.vendors.create({ data: { title: businessName, status: 1 } });
    const user = await tx.users.create({
      data: {
        name,
        email,
        password: hashed,
        phoneNumber,
        status: 1,
        vendorId: vendor.id,
        currentVendorId: vendor.id,
      },
    });
    await tx.nativeMemberships.create({
      data: { vendorId: vendor.id, userId: user.id, role: 'owner', permissions: ['*'] },
    });
    await tx.vendorUsers.create({
      data: { vendorId: vendor.id, userId: user.id, status: 1, data: { permissions: ['*'] } },
    });
    return { userId: user.id, vendorId: vendor.id };
  });
  const challengeId = await issueChallenge(result.userId, 'email');
  return serviceResult(
    { ...result, challengeId, verificationRequired: ['email', 'phone'] },
    { status: 201, format: 'json' },
  );
}
export async function resendVerification(requestInput: ServiceContext) {
  const user = await db.users.findUnique({ where: { email: requestInput.body.email } }),
    verified = await verifyPassword(
      user?.password ?? (await dummyHash),
      requestInput.body.password,
    );
  if (!user || user.status !== 1 || !verified.valid)
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  const challengeId = await issueChallenge(user.id, 'email', {
    cooldownSeconds: 60,
    expectedPassword: user.password,
  });
  return serviceResult(
    {
      challengeId,
      verificationRequired: ['email', 'phone'],
      message: 'A new email verification code has been queued',
    },
    { status: 202, format: 'json' },
  );
}
export async function login(requestInput: ServiceContext) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const identifier: string = requestInput.body.email;
    const emailUser = identifier.includes('@')
      ? await db.users.findUnique({ where: { email: identifier } })
      : null;
    const candidates = identifier.includes('@')
      ? emailUser
        ? [emailUser]
        : []
      : await db.users.findMany({
          where: /^\+?\d+$/.test(identifier)
            ? {
                OR: [
                  { phoneNumber: identifier },
                  {
                    phoneNumber: identifier.startsWith('+')
                      ? identifier.slice(1)
                      : '+' + identifier,
                  },
                ],
              }
            : { username: identifier },
          take: 2,
        });
    const user = candidates.length === 1 ? candidates[0] : null;
    const result = await verifyPassword(
      user?.password ?? (await dummyHash),
      requestInput.body.password,
    );
    if (!result.valid || !user || user.status !== 1)
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (!user.emailVerifiedAt || !user.phoneVerifiedAt)
      throw new ApiError(403, 'VERIFICATION_REQUIRED', 'Verify email and phone before logging in');
    const upgraded = result.needsUpgrade
      ? await hashPassword(requestInput.body.password)
      : user.password;
    const session = await db.$transaction(async (tx) => {
      // The conditional write locks this credential through session creation. A concurrent
      // password reset cannot issue a session for a password that was already replaced.
      const unchanged = await tx.users.updateMany({
        where: {
          id: user.id,
          password: user.password,
          status: 1,
          emailVerifiedAt: { not: null },
          phoneVerifiedAt: { not: null },
        },
        data: { password: upgraded },
      });
      return unchanged.count ? issueSession(tx, user.id) : null;
    });
    if (session) {
      return serviceResult(session, { status: 200, format: 'json' });
    }
  }
  throw new ApiError(401, 'INVALID_CREDENTIALS', 'Account credentials changed; retry login');
}
export async function refreshSession(requestInput: ServiceContext) {
  const old = await db.authSessions.findUnique({
    where: { tokenHash: digest(requestInput.body.refreshToken) },
  });
  if (!old) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  if (old.revokedAt) {
    await db.authSessions.updateMany({
      where: { familyId: old.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new ApiError(401, 'TOKEN_REUSE', 'Refresh token reuse detected');
  }
  const refreshToken = opaqueToken();
  const next = await db.$transaction(
    async (tx) => {
      const user = await tx.users.findUnique({ where: { id: old.userId } });
      if (old.expiresAt <= new Date() || user?.status !== 1)
        throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
      const revoked = await tx.authSessions.updateMany({
        where: { id: old.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1)
        throw new ApiError(401, 'TOKEN_REUSE', 'Refresh token reuse detected');
      return tx.authSessions.create({
        data: {
          userId: old.userId,
          familyId: old.familyId,
          tokenHash: digest(refreshToken),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return serviceResult(
    { accessToken: await accessToken(old.userId, next.id), refreshToken, expiresIn: 900 },
    { status: 200, format: 'json' },
  );
}
export async function logout(requestInput: ServiceContext) {
  await db.authSessions.updateMany({
    where: { userId: requestInput.identity!.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function getCurrentUser(requestInput: ServiceContext) {
  const user = await db.users.findUniqueOrThrow({
    where: { id: requestInput.identity!.userId },
    select: {
      id: true,
      uid: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      currentVendorId: true,
    },
  });
  return serviceResult(user, { status: 200, format: 'json' });
}
export async function verifyEmail(requestInput: ServiceContext) {
  const outcome = await db.$transaction(
    async (tx) => {
      const c = await tx.verificationChallenges.findUnique({
        where: { id: requestInput.body.challengeId },
      });
      if (!c || c.kind !== 'email' || c.consumedAt || c.expiresAt <= new Date() || c.attempts >= 5)
        return false;
      await tx.verificationChallenges.update({
        where: { id: c.id },
        data: { attempts: { increment: 1 } },
      });
      if (!constantEqual(c.codeHash, codeHash(c.id, requestInput.body.code))) return false;
      await tx.verificationChallenges.update({
        where: { id: c.id },
        data: { consumedAt: new Date() },
      });
      await tx.users.update({ where: { id: c.userId }, data: { emailVerifiedAt: new Date() } });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!outcome) throw new ApiError(400, 'INVALID_CODE', 'Invalid or expired verification code');
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function requestPasswordReset(requestInput: ServiceContext) {
  const user = await db.users.findUnique({ where: { email: requestInput.body.email } });
  if (user) await issueChallenge(user.id, 'password-reset');
  return serviceResult(
    { message: 'If the account exists, reset instructions will be sent' },
    { status: 202, format: 'json' },
  );
}
export async function startPhoneVerification(requestInput: ServiceContext) {
  const user = await verifiedPendingUser(
    requestInput.body.challengeId,
    requestInput.body.emailCode,
  );
  await twilioVerify(user.phoneNumber!);
  return serviceResult(
    { message: 'Phone verification requested' },
    { status: 202, format: 'json' },
  );
}
export async function verifyPhone(requestInput: ServiceContext) {
  const user = await verifiedPendingUser(
    requestInput.body.challengeId,
    requestInput.body.emailCode,
  );
  const result = await twilioVerify(user.phoneNumber!, requestInput.body.code);
  if (result.status !== 'approved')
    throw new ApiError(400, 'INVALID_CODE', 'Invalid phone verification code');
  await db.users.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function resetPassword(requestInput: ServiceContext) {
  const hashed = await hashPassword(requestInput.body.password);
  await db.$transaction(
    async (tx) => {
      const c = await tx.verificationChallenges.findUnique({
        where: { id: requestInput.body.challengeId },
      });
      if (
        !c ||
        c.kind !== 'password-reset' ||
        c.consumedAt ||
        c.expiresAt <= new Date() ||
        !constantEqual(c.codeHash, codeHash(c.id, requestInput.body.token))
      )
        throw new ApiError(400, 'INVALID_TOKEN', 'Invalid or expired reset token');
      await tx.verificationChallenges.update({
        where: { id: c.id },
        data: { consumedAt: new Date() },
      });
      await tx.users.update({ where: { id: c.userId }, data: { password: hashed } });
      await tx.authSessions.updateMany({
        where: { userId: c.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return serviceResult(undefined, { status: 204, format: 'end' });
}
