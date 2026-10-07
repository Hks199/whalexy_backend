import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { type RichTemplateValues } from '../../../shared/templates/rich-template.js';

export type StoreNotificationSettings = {
  enabled: boolean;
  phoneNumberId: string;
  rules: (RichTemplateValues & {
    type: string;
    templateId: number;
    bodyParameters: any[];
    headerParameters: any[];
  })[];
};

export async function getStoreIntegration(
  client: Prisma.TransactionClient,
  vendorId: number,
  provider: string,
  id: number,
) {
  const row =
    provider === 'shopify'
      ? await client.shopifyIntegrations.findFirst({ where: { id, vendorId } })
      : await client.woocommerceIntegrations.findFirst({ where: { id, vendorId } });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Store integration not found');
  return row;
}
