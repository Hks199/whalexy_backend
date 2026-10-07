import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { sheetTemplateSchema } from '../../../shared/templates/sheet-template.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import {
  presentSheetIntegration,
  getConfiguredSheetIntegration,
  getSheetCredential,
  readNativeSheetSettings,
  lockSheetIntegration,
} from './sheets-support.service.js';

export async function listSheetIntegrations(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    { page, limit } = requestInput.validatedQuery;
  const [items, total] = await Promise.all([
    db.googleSheetAutomations.findMany({
      where: { vendorId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { id: 'desc' },
    }),
    db.googleSheetAutomations.count({ where: { vendorId } }),
  ]);
  return serviceResult(
    { items: items.map(presentSheetIntegration), total, page, limit },
    { status: 200, format: 'json' },
  );
}

export async function listSheetTemplates(requestInput: ServiceContext) {
  const templates = await db.whatsappTemplates.findMany({
    where: { vendorId: requestInput.identity!.vendorId!, status: 'APPROVED' },
    orderBy: { id: 'desc' },
    take: 500,
  });
  return serviceResult(
    {
      items: templates.map((t) => {
        try {
          return {
            id: t.id,
            uid: t.uid,
            name: t.templateName,
            language: t.languageCode,
            schema: sheetTemplateSchema(t.data),
            supported: true,
          };
        } catch {
          return {
            id: t.id,
            uid: t.uid,
            name: t.templateName,
            language: t.languageCode,
            supported: false,
          };
        }
      }),
    },
    { status: 200, format: 'json' },
  );
}

export async function createSheetIntegration(requestInput: ServiceContext) {
  if (requestInput.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Manage automations using a user session');
  const vendorId = requestInput.identity!.vendorId!,
    c = await getConfiguredSheetIntegration(vendorId, requestInput.body),
    row = await db.$transaction(async (tx) => {
      const row = await tx.googleSheetAutomations.create({
        data: {
          vendorId,
          title: c.title,
          triggerType: c.settings.triggerType,
          config: c.settings as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'create',
          resource: 'sheet-automation',
          resourceId: row.uid,
        },
      });
      return row;
    });
  return serviceResult(presentSheetIntegration(row), { status: 201, format: 'json' });
}

export async function getSheetIntegration(requestInput: ServiceContext) {
  const row = await db.googleSheetAutomations.findFirst({
    where: { uid: String(requestInput.params.uid), vendorId: requestInput.identity!.vendorId! },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
  return serviceResult(presentSheetIntegration(row), { status: 200, format: 'json' });
}

export async function getSheetScript(requestInput: ServiceContext) {
  if (requestInput.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Download scripts using a user session');
  const row = await db.googleSheetAutomations.findFirst({
    where: { uid: String(requestInput.params.uid), vendorId: requestInput.identity!.vendorId! },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
  return serviceResult(getSheetCredential(row.vendorId, row.uid, readNativeSheetSettings(row)), {
    status: 200,
    format: 'send',
    contentType: 'text/plain',
    headers: { 'Content-Disposition': 'attachment; filename="whalexy-sheets.gs"' },
  });
}

export async function updateSheetStatus(requestInput: ServiceContext) {
  if (requestInput.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Manage automations using a user session');
  const vendorId = requestInput.identity!.vendorId!,
    row = await db.$transaction(async (tx) => {
      const current = await tx.googleSheetAutomations.findFirst({
        where: { uid: String(requestInput.params.uid), vendorId },
      });
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
      await lockSheetIntegration(tx, current.id);
      readNativeSheetSettings(current);
      const row = await tx.googleSheetAutomations.update({
        where: { id: current.id },
        data: { status: requestInput.body.enabled ? 1 : 2, updatedAt: new Date() },
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: requestInput.body.enabled ? 'enable' : 'disable',
          resource: 'sheet-automation',
          resourceId: current.uid,
        },
      });
      return row;
    });
  return serviceResult(presentSheetIntegration(row), { status: 200, format: 'json' });
}

export async function deleteSheetIntegration(requestInput: ServiceContext) {
  if (requestInput.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Manage automations using a user session');
  const vendorId = requestInput.identity!.vendorId!;
  await db.$transaction(async (tx) => {
    const row = await tx.googleSheetAutomations.findFirst({
      where: { uid: String(requestInput.params.uid), vendorId },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Automation not found');
    await lockSheetIntegration(tx, row.id);
    await tx.googleSheetAutomations.delete({ where: { id: row.id } });
    await tx.auditEvents.create({
      data: {
        vendorId,
        actorId: requestInput.identity!.userId,
        action: 'delete',
        resource: 'sheet-automation',
        resourceId: row.uid,
      },
    });
  });
  return serviceResult(undefined, { status: 204, format: 'end' });
}
