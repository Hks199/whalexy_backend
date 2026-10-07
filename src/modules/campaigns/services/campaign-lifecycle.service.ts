import { authorizeCampaign } from './campaign-access.service.js';
import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  lockCampaign,
  activeCampaignStatuses,
  finishCampaign,
  terminalCampaignStatuses,
} from './campaigns-support.service.js';

export async function cancelCampaign(requestInput: ServiceContext) {
  await db.$transaction(async (tx) => {
    const campaign = await lockCampaign(
      tx,
      requestInput.identity!.vendorId!,
      Number(requestInput.params.id),
    );
    if (![...activeCampaignStatuses, 'paused'].includes(campaign.status))
      throw new ApiError(
        409,
        'CAMPAIGN_STATE',
        'Campaign cannot be cancelled in its current state',
      );
    await tx.campaigns.update({
      where: { id: campaign.id },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    await tx.whatsappMessageQueue.updateMany({
      where: { vendorId: campaign.vendorId, campaignId: campaign.id, status: { in: [1, 3] } },
      data: { status: 2, data: { cancelled: true }, updatedAt: new Date() },
    });
    await tx.outboxJobs.updateMany({
      where: {
        vendorId: campaign.vendorId,
        kind: 'whatsapp-send',
        status: 'pending',
        OR: [
          { payload: { path: ['campaignId'], equals: campaign.id } },
          { payload: { path: ['campaignTestId'], equals: campaign.id } },
        ],
      },
      data: { status: 'cancelled', lastError: 'CAMPAIGN_CANCELLED' },
    });
    await tx.whatsappMessageLogs.updateMany({
      where: {
        vendorId: campaign.vendorId,
        status: 'queued',
        OR: [
          { campaignId: campaign.id },
          { data: { path: ['campaignTestId'], equals: campaign.id } },
        ],
      },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function pauseCampaign(requestInput: ServiceContext) {
  await db.$transaction(async (tx) => {
    const c = await lockCampaign(
      tx,
      requestInput.identity!.vendorId!,
      Number(requestInput.params.id),
    );
    if (!activeCampaignStatuses.includes(c.status))
      throw new ApiError(409, 'CAMPAIGN_STATE', 'Campaign cannot be paused');
    await tx.campaigns.update({
      where: { id: c.id },
      data: {
        status: 'paused',
        data: { ...(c.data as Prisma.InputJsonObject), resumeStatus: c.status },
        updatedAt: new Date(),
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function resumeCampaign(requestInput: ServiceContext) {
  await db.$transaction(async (tx) => {
    const c = await lockCampaign(
        tx,
        requestInput.identity!.vendorId!,
        Number(requestInput.params.id),
      ),
      data = c.data as any;
    if (c.status !== 'paused' || !activeCampaignStatuses.includes(data?.resumeStatus))
      throw new ApiError(409, 'CAMPAIGN_STATE', 'Campaign is not paused');
    await tx.campaigns.update({
      where: { id: c.id },
      data: { status: data.resumeStatus, updatedAt: new Date() },
    });
    await finishCampaign(tx, c.vendorId, c.id);
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function archiveCampaign(requestInput: ServiceContext) {
  await db.$transaction((tx) => archiveCampaignTransaction(tx, requestInput));
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function restoreCampaign(requestInput: ServiceContext) {
  await db.$transaction((tx) => restoreCampaignTransaction(tx, requestInput));
  return serviceResult(undefined, { status: 204, format: 'end' });
}

export async function archiveCampaignTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  await authorizeCampaign(tx, requestInput, 'vendor.campaigns.send');

  const c = await lockCampaign(
    tx,
    requestInput.identity!.vendorId!,
    Number(requestInput.params.id),
  );
  if (!terminalCampaignStatuses.includes(c.status))
    throw new ApiError(409, 'CAMPAIGN_STATE', 'Stop or finish the campaign before archiving');
  if (
    await tx.outboxJobs.count({
      where: {
        vendorId: c.vendorId,
        kind: 'whatsapp-send',
        status: 'processing',
        OR: [
          { payload: { path: ['campaignId'], equals: c.id } },
          { payload: { path: ['campaignTestId'], equals: c.id } },
        ],
      },
    })
  )
    throw new ApiError(409, 'CAMPAIGN_PROCESSING', 'Wait for in-progress sends before archiving');
  await tx.campaigns.update({
    where: { id: c.id },
    data: {
      status: 'archived',
      data: { ...(c.data as Prisma.InputJsonObject), archivedStatus: c.status },
      updatedAt: new Date(),
    },
  });
  await tx.auditEvents.create({
    data: {
      vendorId: c.vendorId,
      actorId: requestInput.identity!.userId,
      action: 'archive',
      resource: 'campaign',
      resourceId: String(c.id),
    },
  });
}

export async function restoreCampaignTransaction(
  tx: Prisma.TransactionClient,
  requestInput: ServiceContext,
) {
  await authorizeCampaign(tx, requestInput, 'vendor.campaigns.send');

  const c = await lockCampaign(
      tx,
      requestInput.identity!.vendorId!,
      Number(requestInput.params.id),
    ),
    saved = c.data as any;
  if (c.status !== 'archived' || !terminalCampaignStatuses.includes(saved?.archivedStatus))
    throw new ApiError(409, 'CAMPAIGN_STATE', 'Campaign is not a restorable native archive');
  const { archivedStatus, ...data } = saved;
  await tx.campaigns.update({
    where: { id: c.id },
    data: { status: archivedStatus, data, updatedAt: new Date() },
  });
  await tx.auditEvents.create({
    data: {
      vendorId: c.vendorId,
      actorId: requestInput.identity!.userId,
      action: 'unarchive',
      resource: 'campaign',
      resourceId: String(c.id),
    },
  });
}
