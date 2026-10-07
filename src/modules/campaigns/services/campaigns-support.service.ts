import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import { validateCustomFields } from '../../../shared/templates/template-values.js';
import {
  validateRichTemplate,
  type RichTemplateValues,
} from '../../../shared/templates/rich-template.js';

export const CAMPAIGN_BATCH_SIZE = 100;

export type CampaignOptions = RichTemplateValues & {
  phoneNumberId: string;
  groupIds: number[];
  allContacts: boolean;
  phoneNumbers: string[];
  requireTest: boolean;
  restrictLanguage: boolean;
};

export const activeCampaignStatuses = ['awaiting_test', 'scheduled', 'dispatching', 'running'];

export async function lockCampaign(tx: Prisma.TransactionClient, vendorId: number, id: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(606, ${id}::integer)`;
  const campaign = await tx.campaigns.findFirst({ where: { id, vendorId } });
  if (!campaign) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
  return campaign;
}

export async function validateCampaignOptions(
  tx: Prisma.TransactionClient,
  vendorId: number,
  templateId: number,
  options: CampaignOptions,
) {
  const [template, groups, credential] = await Promise.all([
    tx.whatsappTemplates.findFirst({ where: { id: templateId, vendorId, status: 'APPROVED' } }),
    tx.contactGroups.findMany({ where: { id: { in: options.groupIds }, vendorId, status: 1 } }),
    tx.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: {
          vendorId,
          provider: 'whatsapp',
          externalId: options.phoneNumberId,
        },
      },
    }),
  ]);
  if (!template || groups.length !== options.groupIds.length || !credential)
    throw new ApiError(
      400,
      'INVALID_CAMPAIGN',
      'Template, active groups or connected number are unavailable',
    );
  if (
    groups.some(
      (group) => group.wabPhoneNumberId && group.wabPhoneNumberId !== options.phoneNumberId,
    )
  )
    throw new ApiError(
      409,
      'PHONE_SCOPE_MISMATCH',
      'Campaign groups belong to another business number',
    );
  validateRichTemplate(template.data, options);
  await validateCustomFields(tx, vendorId, {
    bodyParameters: [
      ...(options.bodyParameters ?? []),
      ...(options.buttonParameters ?? []).map((button) => button.value),
    ],
    headerParameters: options.headerParameters,
  });
  return template;
}

export async function finishCampaign(
  tx: Prisma.TransactionClient,
  vendorId: number,
  campaignId: number,
) {
  if (
    await tx.whatsappMessageQueue.count({ where: { vendorId, campaignId, status: { in: [1, 3] } } })
  )
    return;
  const failed = await tx.whatsappMessageQueue.count({
    where: { vendorId, campaignId, status: 2 },
  });
  await tx.campaigns.updateMany({
    where: { id: campaignId, vendorId, status: { in: ['running', 'dispatching'] } },
    data: { status: failed ? 'completed_with_errors' : 'completed', updatedAt: new Date() },
  });
}

export function parseCampaignConfiguration(data: Prisma.JsonValue | null) {
  const saved = (data ?? {}) as any;
  return {
    ...Object.fromEntries(
      [
        'phoneNumberId',
        'groupIds',
        'allContacts',
        'phoneNumbers',
        'restrictLanguage',
        'bodyParameters',
        'headerParameters',
        'mediaHeader',
        'buttonParameters',
        'copyCode',
      ].map((key) => [key, saved[key]]),
    ),
    requireTest: saved.requireTest ?? false,
  };
}

export function campaignTestHash(templateId: number, data: Prisma.JsonValue | null) {
  return digest(JSON.stringify({ templateId, ...parseCampaignConfiguration(data) }));
}

export const terminalCampaignStatuses = [
  'completed',
  'completed_with_errors',
  'cancelled',
  'blocked',
];
