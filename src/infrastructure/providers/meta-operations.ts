import { db } from '../../database/client.js';
import { digest } from '../../utils/crypto.js';
import { ApiError } from '../../shared/api-error.js';
import type { ServiceContext } from '../../shared/service-context.js';
import { headerValue } from '../../utils/headers.js';
import type { Prisma } from '@prisma/client';

function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
}
// Graph mutations have no general idempotency guarantee. Persist intent before
// calling Graph, and never repeat an effect whose acceptance cannot be proved.
export async function metaOperation(
  req: ServiceContext,
  resource: string,
  input: unknown,
  perform: (effect: <T>(call: () => Promise<T>) => Promise<T>) => Promise<any>,
  commit: (tx: Prisma.TransactionClient, value: any) => Promise<void>,
) {
  const vendorId = req.identity!.vendorId!,
    raw = headerValue(req.headers, 'Idempotency-Key');
  if (!raw || !/^[A-Za-z0-9_-]{8,100}$/.test(raw))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const key = `meta-operation:${raw}`,
    hash = digest(JSON.stringify(canonical({ resource, input })));
  const claim = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-operation:${vendorId}:${resource}`},0))`;
    const old = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (old) {
      if (old.requestHash !== hash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for another provider operation',
        );
      const state = old.response as any;
      if (state.state === 'complete') return { result: state.result };
      if (state.state === 'rejected')
        throw new ApiError(
          state.status ?? 409,
          state.code ?? 'PROVIDER_REJECTED',
          'The original provider operation was rejected',
        );
      throw new ApiError(
        409,
        'PROVIDER_RECONCILIATION_REQUIRED',
        'Reconcile the prior provider operation before repeating it',
      );
    }
    if (
      await tx.nativeIdempotency.findFirst({
        where: {
          vendorId,
          key: { startsWith: 'meta-operation:' },
          AND: [
            { response: { path: ['resource'], equals: resource } },
            {
              OR: [
                { response: { path: ['state'], equals: 'processing' } },
                { response: { path: ['state'], equals: 'uncertain' } },
              ],
            },
          ],
        },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'PROVIDER_RECONCILIATION_REQUIRED',
        'This resource has an unresolved provider operation',
      );
    return {
      row: await tx.nativeIdempotency.create({
        data: {
          vendorId,
          key,
          requestHash: hash,
          response: { state: 'processing', resource, createdAt: new Date().toISOString() },
        },
      }),
    };
  });
  if ('result' in claim) return claim.result;
  let started = false,
    accepted: any;
  try {
    const value = await perform(async (call) => {
      started = true;
      return call();
    });
    accepted = value;
    await db.$transaction(async (tx) => {
      await commit(tx, value);
      await tx.nativeIdempotency.update({
        where: { id: claim.row.id },
        data: { response: { state: 'complete', resource, result: value } },
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: req.identity!.userId,
          action: 'provider-operation',
          resource,
          resourceId: claim.row.id,
        },
      });
    });
    return value;
  } catch (error) {
    // Even a success followed by a local write failure needs reconciliation.
    const rejected = !started || (error instanceof ApiError && error.code === 'PROVIDER_REJECTED');
    await db.nativeIdempotency.update({
      where: { id: claim.row.id },
      data: {
        response: {
          state: rejected ? 'rejected' : 'uncertain',
          resource,
          ...(accepted ? { acceptedResult: accepted } : {}),
          code: error instanceof ApiError ? error.code : 'PROVIDER_OPERATION_ERROR',
          status: error instanceof ApiError ? error.status : 500,
        },
      },
    });
    throw error;
  }
}
