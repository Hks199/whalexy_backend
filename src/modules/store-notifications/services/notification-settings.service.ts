import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { validateRichTemplate } from '../../../shared/templates/rich-template.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
import { getStoreIntegration } from './store-notifications-support.service.js';

export async function getStoreNotificationSettings(requestInput: ServiceContext) {
  const row = await getStoreIntegration(
    db,
    requestInput.identity!.vendorId!,
    String(requestInput.params.provider),
    Number(requestInput.params.integrationId),
  );
  return serviceResult(
    (row.data as any)?.nodeNotifications ?? { enabled: false, phoneNumberId: null, rules: [] },
    { status: 200, format: 'json' },
  );
}

export async function updateStoreNotificationSettings(requestInput: ServiceContext) {
  await db.$transaction((tx) => writeStoreNotificationSettings(tx, requestInput));
  return serviceResult(undefined, { status: 204, format: 'empty' });
}

export async function writeStoreNotificationSettings(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  const vendorId = requestInput.identity!.vendorId!,
    provider = String(requestInput.params.provider),
    id = Number(requestInput.params.integrationId);

  const permissions = await currentContactPermissions(tx, requestInput);
  if (!permissions.includes('*') && !permissions.includes('vendor.integrations.manage'))
    throw new ApiError(403, 'FORBIDDEN', 'Integration management permission required');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`store-settings:${provider}:${id}`},0))`;
  const row = await getStoreIntegration(tx, vendorId, provider, id);
  if (row.data !== null && (typeof row.data !== 'object' || Array.isArray(row.data)))
    throw new ApiError(
      409,
      'STORE_DATA_RECONCILIATION_REQUIRED',
      'Imported store metadata requires reconciliation before updating settings',
    );
  const sender = await tx.integrationCredentials.findUnique({
    where: {
      vendorId_provider_externalId: {
        vendorId,
        provider: 'whatsapp',
        externalId: requestInput.body.phoneNumberId,
      },
    },
  });
  const disablingExistingSender =
    requestInput.body.enabled === false &&
    requestInput.body.rules.length === 0 &&
    (row.data as any)?.nodeNotifications?.phoneNumberId === requestInput.body.phoneNumberId;
  if (!sender && !disablingExistingSender)
    throw new ApiError(400, 'INVALID_PHONE_NUMBER', 'Select an owned connected WhatsApp number');
  for (const rule of requestInput.body.rules) {
    const template = await tx.whatsappTemplates.findFirst({
      where: { vendorId, id: rule.templateId, status: 'APPROVED' },
    });
    if (!template) throw new ApiError(400, 'INVALID_TEMPLATE', 'Select an owned approved template');
    validateRichTemplate(template.data, rule);
  }
  const data = {
    ...((row.data as Prisma.InputJsonObject) ?? {}),
    nodeNotifications: requestInput.body,
  };
  if (provider === 'shopify')
    await tx.shopifyIntegrations.update({
      where: { id },
      data: {
        data,
        notificationTypes: requestInput.body.rules.map((r: any) => r.type).join(','),
        updatedAt: new Date(),
      },
    });
  else
    await tx.woocommerceIntegrations.update({
      where: { id },
      data: {
        data,
        notificationTypes: requestInput.body.rules.map((r: any) => r.type).join(','),
        updatedAt: new Date(),
      },
    });
  await tx.auditEvents.create({
    data: {
      vendorId,
      actorId: requestInput.identity!.userId,
      action: 'configure',
      resource: 'store-notifications',
      resourceId: `${provider}:${id}`,
    },
  });
}
