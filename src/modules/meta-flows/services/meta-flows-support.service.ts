import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { metaRequest } from '../../../infrastructure/providers/meta.client.js';
import { remoteId, categories } from '../meta-flows.validation.js';

export const flowDetailFields = 'id,name,status,categories,validation_errors,endpoint_uri';

export function throwMetaFlowResponseError(): never {
  throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid Meta Flow response');
}

export function requireMetaId(value: any): string {
  if (remoteId.validate(value, { convert: false }).error) throwMetaFlowResponseError();
  return value;
}

export function validateMetaInputId(value: any): string {
  if (remoteId.validate(value, { convert: false }).error)
    throw new ApiError(400, 'INVALID_FLOW_ID', 'Invalid Flow identifier');
  return value;
}

export function parseMetaFlowSnapshot(value: any) {
  requireMetaId(value.id);
  if (
    typeof value.name !== 'string' ||
    value.name.length > 255 ||
    !['DRAFT', 'PUBLISHED', 'DEPRECATED', 'THROTTLED', 'BLOCKED'].includes(value.status) ||
    !Array.isArray(value.categories) ||
    categories.validate(value.categories).error
  )
    throwMetaFlowResponseError();
  return {
    name: value.name,
    status: value.status,
    categories: value.categories as Prisma.InputJsonArray,
    validationErrors: (value.validation_errors ?? []) as Prisma.InputJsonValue,
    endpointUri: typeof value.endpoint_uri === 'string' ? value.endpoint_uri : null,
  };
}

export async function getFlowAccountContext(vendorId: number, phone: string) {
  const credential = await db.integrationCredentials.findUnique({
    where: { vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phone } },
  });
  const waba = (credential?.metadata as any)?.wabaId;
  if (!credential || typeof waba !== 'string' || remoteId.validate(waba).error)
    throw new ApiError(
      503,
      'WHATSAPP_ACCOUNT_NOT_CONFIGURED',
      'A connected WhatsApp business account is required',
    );
  // A manually supplied WABA ID is not proof that this phone belongs to it.
  const seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await metaRequest(
      vendorId,
      'whatsapp',
      phone,
      `${waba}/phone_numbers`,
      'GET',
      undefined,
      { fields: 'id', limit: '100', ...(after ? { after } : {}) },
    );
    if (!Array.isArray(result.data)) throwMetaFlowResponseError();
    if (result.data.some((row: any) => row.id === phone)) return { credential, waba };
    if (!result.paging?.next) break;
    after = validateFlowCursor(result, seen);
  }
  throw new ApiError(
    403,
    'ACCOUNT_OWNER_MISMATCH',
    'The sending number does not belong to the configured business account',
  );
}

export function validateFlowCursor(result: any, seen: Set<string>) {
  const after = result.paging?.cursors?.after;
  if (typeof after !== 'string' || !after || after.length > 4096 || seen.has(after))
    throw new ApiError(502, 'PROVIDER_PAGINATION', 'Invalid or repeated Meta pagination cursor');
  seen.add(after);
  return after;
}

export async function getOwnedMetaFlow(
  vendorId: number,
  waba: string,
  flowId: string,
  includeDeleted = false,
) {
  const flow = await db.nativeMetaFlows.findFirst({
    where: {
      id: flowId,
      vendorId,
      wabaId: waba,
      ...(!includeDeleted ? { status: { not: 'DELETED' } } : {}),
    },
  });
  if (!flow)
    throw new ApiError(404, 'NOT_FOUND', 'Flow not found; sync this business account first');
  return flow;
}

export function validateFlowJson(value: any) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.version !== 'string' ||
    !/^[0-9]+\.[0-9]+$/.test(value.version) ||
    !Array.isArray(value.screens) ||
    !value.screens.length ||
    value.screens.length > 100 ||
    Buffer.byteLength(JSON.stringify(value)) > 500000
  )
    throw new ApiError(
      400,
      'INVALID_FLOW_JSON',
      'A bounded Flow JSON definition with version and screens is required',
    );
  const seen = new Set<string>();
  for (const screen of value.screens) {
    if (
      !screen ||
      typeof screen.id !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(screen.id) ||
      seen.has(screen.id) ||
      screen.layout?.type !== 'SingleColumnLayout' ||
      !Array.isArray(screen.layout.children) ||
      !screen.data ||
      Array.isArray(screen.data) ||
      typeof screen.data !== 'object'
    )
      throw new ApiError(
        400,
        'INVALID_FLOW_JSON',
        'Flow screens need unique Meta identifiers, data objects and layouts',
      );
    seen.add(screen.id);
  }
  return value;
}
