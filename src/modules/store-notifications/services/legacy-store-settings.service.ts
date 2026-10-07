import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
import { digest } from '../../../utils/crypto.js';
import { sheetTemplateSchema } from '../../../shared/templates/sheet-template.js';
import { mappingsSchema } from '../legacy-store-settings.validation.js';
import { types, settingSchema } from '../store-notifications.validation.js';
import { writeStoreNotificationSettings } from './notification-settings.service.js';
const fields: Record<string, string> = {
  order_number: 'orderNumber',
  order_id: 'orderId',
  order_total: 'total',
  total_price: 'total',
  order_status: 'status',
  status: 'status',
  currency: 'currency',
  customer_name: 'customerName',
  tracking_number: 'trackingNumber',
  tracking_url: 'trackingUrl',
};
function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
export async function legacyStoreSettings(
  input: ServiceContext,
  provider: 'shopify' | 'woocommerce',
) {
  const vendorId = input.identity!.vendorId!,
    key = input.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  let raw: unknown = input.body.variable_mapping ?? {};
  if (provider === 'shopify' && input.body.variable_mappings) {
    try {
      raw = JSON.parse(input.body.variable_mappings);
    } catch {
      throw new ApiError(
        400,
        'INVALID_VARIABLE_MAPPINGS',
        'Variable mappings must be a JSON object',
      );
    }
  }
  const checked = mappingsSchema.validate(raw);
  if (checked.error)
    throw new ApiError(400, 'INVALID_VARIABLE_MAPPINGS', 'Invalid numbered variable mappings');
  const mappings = checked.value;
  const hash = digest(
    JSON.stringify(
      canonical({
        provider,
        query: input.validatedQuery,
        body: { ...input.body, variable_mapping: mappings, variable_mappings: undefined },
      }),
    ),
  );
  const response = await db
    .$transaction(
      async (tx) => {
        const permissions = await currentContactPermissions(tx, input);
        if (!permissions.includes('*') && !permissions.includes('vendor.integrations.manage'))
          throw new ApiError(403, 'FORBIDDEN', 'Integration management permission required');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`legacy-store-settings:${vendorId}:${key}`},0))`;
        const where = {
          vendorId,
          ...(input.validatedQuery.integration_id
            ? { id: input.validatedQuery.integration_id }
            : {}),
        };
        const stores =
          provider === 'shopify'
            ? await tx.shopifyIntegrations.findMany({ where, take: 2 })
            : await tx.woocommerceIntegrations.findMany({ where, take: 2 });
        if (!stores.length) throw new ApiError(404, 'NOT_FOUND', 'Store integration not found');
        if (stores.length !== 1)
          throw new ApiError(
            409,
            'STORE_SCOPE_REQUIRED',
            'Select one owned integration with integration_id',
          );
        const store = stores[0];
        const replay = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key: `legacy-store-settings:${key}` } },
        });
        if (replay) {
          if (replay.requestHash !== hash)
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for different settings');
          return replay.response;
        }
        const selected = input.body.notification_types as string[];
        if (
          Object.keys(input.body.template_uid).some((type) => !selected.includes(type)) ||
          Object.keys(mappings).some((type) => !selected.includes(type))
        )
          throw new ApiError(
            400,
            'UNSELECTED_MAPPING',
            'Mappings must belong to enabled notification types',
          );
        const triggeredTypes =
          provider === 'shopify'
            ? [
                'order_confirmation',
                'payment_confirmation',
                'shipment_tracking',
                'order_cancelled',
                'refund_processed',
              ]
            : [
                'order_confirmation',
                'payment_confirmation',
                'order_processing',
                'order_completed',
                'order_on_hold',
                'order_cancelled',
                'refund_processed',
                'order_failed',
              ];
        if (selected.some((type) => !types.includes(type) || !triggeredTypes.includes(type)))
          throw new ApiError(
            409,
            'UNSUPPORTED_NOTIFICATION_TYPE',
            'The selected notification type requires its provider event workflow',
          );
        let phone =
          input.body.phone_number_id ?? (store.data as any)?.nodeNotifications?.phoneNumberId;
        if (!phone) {
          const senders = await tx.integrationCredentials.findMany({
            where: { vendorId, provider: 'whatsapp' },
            select: { externalId: true },
            take: 2,
          });
          if (senders.length !== 1)
            throw new ApiError(
              409,
              'PHONE_SCOPE_REQUIRED',
              'Select one owned connected sender with phone_number_id',
            );
          phone = senders[0].externalId;
        }
        const rules = [];
        for (const type of selected) {
          const uid = input.body.template_uid[type];
          const template = uid
            ? await tx.whatsappTemplates.findFirst({ where: { vendorId, uid, status: 'APPROVED' } })
            : null;
          if (!template)
            throw new ApiError(
              400,
              'INVALID_TEMPLATE',
              'Select an owned approved template for every notification type',
            );
          const shape = sheetTemplateSchema(template.data);
          if (shape.media || shape.buttons.length || shape.copy !== null)
            throw new ApiError(
              409,
              'LEGACY_TEMPLATE_MAPPING_UNSUPPORTED',
              'Configure rich headers and dynamic buttons through native notification settings',
            );
          const values = mappings[type] ?? {},
            count = Math.max(shape.body, shape.header);
          if (
            Object.keys(values).length !== count ||
            Object.keys(values).some((k) => Number(k) > count)
          )
            throw new ApiError(
              400,
              'INCOMPLETE_VARIABLE_MAPPING',
              'Map every numbered template variable exactly once',
            );
          const value = (index: number) => {
            const field = fields[values[String(index + 1)]];
            if (!field || (provider === 'woocommerce' && field.startsWith('tracking')))
              throw new ApiError(
                409,
                'UNSUPPORTED_ORDER_FIELD',
                'This source order field needs a native delivery mapping',
              );
            return { orderField: field, fallback: '-' };
          };
          rules.push({
            type,
            templateId: template.id,
            bodyParameters: Array.from({ length: shape.body }, (_, i) => value(i)),
            headerParameters: Array.from({ length: shape.header }, (_, i) => value(i)),
          });
        }
        const setting = settingSchema.validate({
          enabled: selected.length > 0,
          phoneNumberId: phone,
          rules,
        });
        if (setting.error)
          throw new ApiError(
            400,
            'INVALID_NOTIFICATION_SETTINGS',
            'Invalid native notification configuration',
          );
        await writeStoreNotificationSettings(tx, {
          ...input,
          params: { provider, integrationId: store.id },
          body: setting.value,
        });
        const result = { success: true, message: 'Notification settings updated successfully' };
        await tx.nativeIdempotency.create({
          data: {
            vendorId,
            key: `legacy-store-settings:${key}`,
            requestHash: hash,
            response: result,
          },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(
          409,
          'SETTINGS_CONFLICT',
          'Settings changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(response, { status: 200, format: 'json' });
}
