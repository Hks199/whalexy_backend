import { Prisma } from '@prisma/client';
import { authorizeCampaign } from './campaign-access.service.js';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { optionsSchema } from '../campaigns.validation.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  validateCampaignOptions,
  lockCampaign,
  parseCampaignConfiguration,
} from './campaigns-support.service.js';

export async function listCampaigns(requestInput: ServiceContext) {
  const q = requestInput.validatedQuery;
  return serviceResult(
    await db.campaigns.findMany({
      where: {
        vendorId: requestInput.identity!.vendorId!,
        status: q.archived ? 'archived' : { not: 'archived' },
      },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        uid: true,
        title: true,
        status: true,
        scheduledAt: true,
        templateId: true,
      },
    }),
    { status: 200, format: 'json' },
  );
}

export async function createCampaign(requestInput: ServiceContext) {
  const { title, templateId, scheduledAt, ...options } = requestInput.body,
    vendorId = requestInput.identity!.vendorId!;
  if (!options.requireTest && !can(requestInput, 'vendor.campaigns.skip_test'))
    throw new ApiError(403, 'FORBIDDEN', 'Skipping a test requires explicit campaign permission');
  const campaign = await db.$transaction(async (tx) => {
    await validateCampaignOptions(tx, vendorId, templateId, options);
    const c = await tx.campaigns.create({
      data: {
        vendorId,
        title,
        templateId,
        status: options.requireTest ? 'awaiting_test' : 'scheduled',
        scheduledAt,
        data: options,
      },
    });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: options.requireTest ? 'create' : 'create-without-test',
        resource: 'campaign',
        resourceId: String(c.id),
      },
    });
    return c;
  });
  return serviceResult(
    {
      id: campaign.id,
      uid: campaign.uid,
      status: campaign.status,
      scheduledAt: campaign.scheduledAt,
    },
    { status: 201, format: 'json' },
  );
}

export async function duplicateCampaign(requestInput: ServiceContext) {
  const copy = await db.$transaction((tx) => duplicateCampaignTransaction(tx, requestInput));
  return serviceResult(
    { id: copy.id, uid: copy.uid, status: copy.status },
    { status: 201, format: 'json' },
  );
}

export async function duplicateCampaignTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
  forceTest = false,
) {
  const permissions = await authorizeCampaign(tx, requestInput, 'vendor.campaigns.create');

  const c = await lockCampaign(
    tx,
    requestInput.identity!.vendorId!,
    Number(requestInput.params.id),
  );
  const checked = optionsSchema.validate({
    ...parseCampaignConfiguration(c.data),
    ...(forceTest ? { requireTest: true } : {}),
  });
  if (checked.error)
    throw new ApiError(
      409,
      'CAMPAIGN_CONFIGURATION',
      'Campaign configuration cannot be duplicated',
    );
  if (
    !checked.value.requireTest &&
    !permissions.includes('*') &&
    !permissions.includes('vendor.campaigns.skip_test')
  )
    throw new ApiError(403, 'FORBIDDEN', 'Skipping a test requires explicit campaign permission');
  await validateCampaignOptions(tx, c.vendorId, c.templateId, checked.value);
  const copy = await tx.campaigns.create({
    data: {
      vendorId: c.vendorId,
      templateId: c.templateId,
      title: requestInput.body.title,
      scheduledAt: requestInput.body.scheduledAt,
      status: checked.value.requireTest ? 'awaiting_test' : 'scheduled',
      data: checked.value,
    },
  });
  await tx.auditEvents.create({
    data: {
      vendorId: c.vendorId,
      actorId: requestInput.identity!.userId,
      action: checked.value.requireTest ? 'duplicate' : 'duplicate-without-test',
      resource: 'campaign',
      resourceId: String(copy.id),
      metadata: { sourceCampaignId: c.id },
    },
  });
  return copy;
}
