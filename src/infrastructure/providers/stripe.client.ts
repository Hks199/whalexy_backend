import { db } from '../../database/client.js';
import { digest } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import { providerRequest } from './meta.client.js';
import type { Prisma } from '@prisma/client';

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
export async function stripeRequest(
  path: string,
  body?: Record<string, string>,
  key?: string,
  query?: Record<string, string>,
) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ApiError(503, 'STRIPE_NOT_CONFIGURED', 'Stripe billing is not configured');
  if (!/^\/[a-z0-9_/-]+$/.test(path))
    throw new ApiError(400, 'INVALID_PROVIDER_PATH', 'Invalid Stripe resource');
  const url = new URL(`https://api.stripe.com/v1${path}`);
  if (query) for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return providerRequest(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
}
// Persist the request before calling Stripe. An interrupted operation reuses the same
// provider key within its retention window; a late retry needs explicit reconciliation.
export async function stripeOperation(
  vendorId: number,
  key: string,
  body: Record<string, string>,
  path: string,
  check: (value: any) => void,
) {
  const requestHash = digest(
    JSON.stringify({
      path,
      body: Object.fromEntries(Object.entries(body).sort(([a], [b]) => a.localeCompare(b))),
    }),
  );
  const claim = await db.$transaction(async (tx) => {
    if (key.startsWith('stripe:checkout:'))
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-billing:${vendorId}`},0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-operation:${vendorId}:${key.startsWith('stripe:checkout:') ? 'checkout' : key}`},0))`;
    const old = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (old) {
      if (old.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for a different billing request',
        );
      const state = old.response as any;
      if (state?.state === 'complete') return { row: old, result: state.result };
      if (old.createdAt.getTime() < Date.now() - 23 * 3600000)
        throw new ApiError(
          409,
          'BILLING_RECONCILIATION_REQUIRED',
          'This interrupted billing request requires provider reconciliation',
        );
      if (state?.state === 'processing' && Number(state.claimedAt) > Date.now() - 60000)
        throw new ApiError(
          409,
          'BILLING_IN_PROGRESS',
          'Billing request is already being processed',
        );
      return {
        row: await tx.nativeIdempotency.update({
          where: { id: old.id },
          data: { response: { state: 'processing', claimedAt: Date.now() } },
        }),
      };
    }
    if (key.startsWith('stripe:checkout:')) {
      if (
        await tx.manualSubscriptions.findFirst({
          where: {
            vendorId,
            OR: [
              { status: { in: ['initiated', 'pending'] } },
              { status: 'active', OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
            ],
          },
          select: { id: true },
        })
      )
        throw new ApiError(
          409,
          'MANUAL_SUBSCRIPTION_EXISTS',
          'Resolve the manual payment or subscription before starting checkout',
        );
      const others = await tx.nativeIdempotency.findMany({
        where: { vendorId, key: { startsWith: 'stripe:checkout:' } },
        select: { response: true },
      });
      if (
        others.some((row) => {
          const state = row.response as any;
          return (
            state?.state !== 'complete' ||
            (state.result?.status === 'open' && Number(state.result.expires_at) * 1000 > Date.now())
          );
        })
      )
        throw new ApiError(
          409,
          'CHECKOUT_EXISTS',
          'Resolve the existing checkout before creating another',
        );
    }
    return {
      row: await tx.nativeIdempotency.create({
        data: {
          vendorId,
          key,
          requestHash,
          response: { state: 'processing', claimedAt: Date.now() },
        },
      }),
    };
  });
  if ('result' in claim) return claim.result;
  try {
    const result = await stripeRequest(path, body, `whalexy:${claim.row.id}`);
    check(result);
    await db.nativeIdempotency.update({
      where: { id: claim.row.id },
      data: { response: { state: 'complete', result: result as Prisma.InputJsonObject } },
    });
    return result;
  } catch (error) {
    await db.nativeIdempotency.update({
      where: { id: claim.row.id },
      data: { response: { state: 'uncertain' } },
    });
    throw error;
  }
}
export function providerId(value: unknown, prefix: string) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9_]{1,200}$`).test(value))
    throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid Stripe resource identifier');
  return value;
}
export function stripeUrl(value: unknown, host: string) {
  try {
    const url = new URL(String(value));
    if (
      url.protocol === 'https:' &&
      url.hostname === host &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.href;
  } catch {}
  throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid Stripe redirect URL');
}
