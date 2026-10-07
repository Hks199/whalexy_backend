import {
  createContactGroup,
  updateContactGroup,
} from '../contact-workflows/services/contact-groups.service.js';
import {
  createContactLabel,
  updateContactLabel,
} from '../contact-workflows/services/contact-labels.service.js';
import Joi from 'joi';
import { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

// Only explicitly approved domain tables are exposed. This is local data management,
// not a substitute for Meta publishing, checkout, or workflow execution endpoints.
export const resources: Record<
  string,
  {
    model: string;
    read: string;
    write?: string;
  }
> = {
  groups: { model: 'ContactGroups', read: 'vendor.contacts.view', write: 'vendor.groups.manage' },
  labels: { model: 'Labels', read: 'vendor.contacts.view', write: 'vendor.groups.manage' },
  'custom-fields': { model: 'ContactCustomFields', read: 'vendor.contacts.view' },
  'bot-flows': { model: 'BotFlows', read: 'vendor.bot.manage' },
  'flow-launch-settings': { model: 'WhatsappFlowLaunchSettings', read: 'vendor.bot.manage' },
  'flow-responses': { model: 'WhatsappFlowResponses', read: 'vendor.contacts.view' },
  'away-settings': { model: 'OutOfOfficeSettings', read: 'vendor.out_of_office.view' },
  'comment-automations': { model: 'CommentToDmAutomations', read: 'vendor.bot.manage' },
  'comment-executions': { model: 'CommentToDmExecutions', read: 'vendor.bot.manage' },
  'sheet-automations': { model: 'GoogleSheetAutomations', read: 'vendor.integrations.manage' },
  catalogs: { model: 'Catalogs', read: 'catalog.view' },
  products: { model: 'Products', read: 'catalog.view' },
  'catalog-sync-logs': { model: 'CatalogSyncLogs', read: 'catalog.view' },
  'catalog-activity-logs': { model: 'CatalogActivityLogs', read: 'catalog.view' },
  orders: { model: 'WhatsappOrders', read: 'manage_whatsapp_orders' },
  payments: { model: 'WhatsappPayments', read: 'manage_whatsapp_orders' },
  'shopify-orders': { model: 'ShopifyOrders', read: 'vendor.integrations.manage' },
  'woocommerce-orders': { model: 'WoocommerceOrders', read: 'vendor.integrations.manage' },
  'shopify-notifications': {
    model: 'ShopifyOrderNotifications',
    read: 'vendor.integrations.manage',
  },
  'woocommerce-notifications': {
    model: 'WoocommerceOrderNotifications',
    read: 'vendor.integrations.manage',
  },
  'appointment-services': {
    model: 'WhalexyAppointmentServices',
    read: 'vendor.appointments.view',
  },
  'appointment-resources': {
    model: 'WhalexyAppointmentResources',
    read: 'vendor.appointments.view',
  },
  'appointment-schedules': {
    model: 'WhalexyAppointmentSchedules',
    read: 'vendor.appointments.view',
  },
  'appointment-exceptions': {
    model: 'WhalexyAppointmentScheduleExceptions',
    read: 'vendor.appointments.view',
  },
  'appointment-automation': {
    model: 'WhalexyAppointmentAutomationSettings',
    read: 'vendor.appointments.view',
  },
  'appointment-reminders': {
    model: 'WhalexyAppointmentReminderDeliveries',
    read: 'vendor.appointments.view',
  },
  'ai-analysis': { model: 'ConversationAiAnalysis', read: 'vendor.ai.manage' },
  'cx-scores': { model: 'ConversationCxScores', read: 'vendor.cx.view' },
  classifications: { model: 'ConversationClassifications', read: 'vendor.cx.view' },
  'classification-tags': { model: 'ConversationClassificationTags', read: 'vendor.cx.view' },
  'classification-history': { model: 'ConversationClassificationLogs', read: 'vendor.cx.view' },
  'ai-handoffs': { model: 'AiConversationHandoffs', read: 'vendor.ai.manage' },
  'ai-usages': { model: 'VendorAiUsages', read: 'administrative' },
  'ai-invoices': { model: 'VendorAiMonthlyInvoices', read: 'administrative' },
  subscriptions: { model: 'Subscriptions', read: 'administrative' },
  'subscription-addons': { model: 'SubscriptionAddons', read: 'administrative' },
  'ad-accounts': { model: 'AdAccounts', read: 'ads.view' },
  'ad-campaigns': { model: 'AdCampaigns', read: 'ads.view' },
  'ad-sets': { model: 'AdSets', read: 'ads.view' },
  'ad-creatives': { model: 'AdCreatives', read: 'ads.view' },
  ads: { model: 'Ads', read: 'ads.view' },
  audiences: { model: 'Audiences', read: 'ads.view', write: 'ads.edit' },
  'ad-labels': { model: 'AdLabels', read: 'ads.view', write: 'ads.edit' },
  'ad-metrics': { model: 'CampaignMetrics', read: 'ads.analytics' },
  'ad-daily-metrics': { model: 'CampaignDailyMetrics', read: 'ads.analytics' },
  conversions: { model: 'Conversions', read: 'ads.analytics' },
  'ad-reports': { model: 'Reports', read: 'ads.reports' },
  'ad-attributions': { model: 'AdConversationAttributions', read: 'ads.analytics' },
  'ad-notifications': { model: 'AdNotifications', read: 'ads.view' },
  'ad-budgets': { model: 'Budgets', read: 'ads.billing' },
  'blue-tick-applications': {
    model: 'WhatsappBlueTickApplications',
    read: 'vendor.whatsapp_setup.manage',
  },
  'calling-settings': { model: 'WhatsappCallingSettings', read: 'vendor.calls.use' },
  calls: { model: 'WhatsappCalls', read: 'vendor.calls.use' },
};
export type Delegate = {
  findMany: (args: any) => Promise<any[]>;
  findFirst: (args: any) => Promise<any>;
  count: (args: any) => Promise<number>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
};
export const delegate = (name: string, client: any = db): Delegate =>
  client[name[0].toLowerCase() + name.slice(1)];
export const hidden =
  /password|secret|token|session|generatedScript|dmAttachmentPath|^error$|gatewayResponse|rawPayload|signature|payload|^data$|^meta$|^metadata$|peer|customerPhone|customerEmail|customerName|contactWaId|whatsappNumber/i;
export const serverFields = new Set([
  'id',
  'uid',
  'uuid',
  'vendorId',
  'organizationId',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
]);
export function modelFields(name: string) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
  if (!model) throw new Error('Unknown configured model');
  return model.fields;
}
export function projection(name: string) {
  return Object.fromEntries(
    modelFields(name)
      .filter(
        (f) =>
          f.kind !== 'object' &&
          !hidden.test(f.name) &&
          !(name === 'GoogleSheetAutomations' && f.name === 'config') &&
          !(
            name === 'AdConversationAttributions' &&
            ['ctwaClickId', 'sourceUrl', 'referral', 'utmParameters'].includes(f.name)
          ),
      )
      .map((f) => [f.name, true]),
  );
}
export function schemaFor(name: string, patch = false) {
  const fields: Record<string, Joi.Schema> = {};
  for (const f of modelFields(name)) {
    if (f.kind === 'object' || serverFields.has(f.name) || hidden.test(f.name)) continue;
    let s: Joi.Schema =
      f.type === 'Int'
        ? Joi.number().integer().min(-2147483648).max(2147483647)
        : f.type === 'Float'
          ? Joi.number()
          : f.type === 'Decimal'
            ? Joi.string().pattern(/^-?\d{1,14}(\.\d{1,4})?$/)
            : f.type === 'Boolean'
              ? Joi.boolean()
              : f.type === 'DateTime'
                ? Joi.date().iso()
                : f.type === 'Json'
                  ? Joi.alternatives().try(Joi.object().max(100), Joi.array().max(100))
                  : Joi.string().max(10000);
    if (!f.isRequired) s = s.allow(null);
    if (!patch && f.isRequired && !f.hasDefaultValue) s = s.required();
    fields[f.name] = s;
  }
  return Joi.object(fields).min(1);
}
export async function validateRelations(
  name: string,
  input: Record<string, unknown>,
  vendorId: number,
) {
  for (const relation of modelFields(name).filter(
    (f) => f.kind === 'object' && f.relationFromFields?.length,
  )) {
    const fields = relation.relationFromFields!;
    if (fields.length !== 1) continue;
    const fk = fields[0],
      value = input[fk];
    if (value === null || value === undefined) continue;
    if (relation.type === 'Vendors') {
      if (value !== vendorId)
        throw new ApiError(403, 'FORBIDDEN', 'Cross-business reference denied');
      continue;
    }
    if (relation.type === 'Users') {
      const member = await db.nativeMemberships.findUnique({
        where: { vendorId_userId: { vendorId, userId: Number(value) } },
      });
      if (!member?.active)
        throw new ApiError(400, 'INVALID_REFERENCE', 'Referenced user is not a business member');
      continue;
    }
    const target = modelFields(relation.type);
    const scoped = target.some((f) => f.name === 'vendorId');
    if (!scoped)
      throw new ApiError(
        400,
        'UNVERIFIED_REFERENCE',
        'Reference requires a dedicated domain endpoint',
      );
    const pk = relation.relationToFields?.[0] ?? 'id';
    const record = await delegate(relation.type).findFirst({ where: { [pk]: value, vendorId } });
    if (!record)
      throw new ApiError(
        400,
        'INVALID_REFERENCE',
        'Related record is unavailable in this business',
      );
  }
  // Appointment relationships are logical columns in the source, not declared FKs.
  for (const [field, target] of Object.entries({
    appointmentServiceId: 'WhalexyAppointmentServices',
    appointmentResourceId: 'WhalexyAppointmentResources',
  })) {
    if (
      input[field] !== undefined &&
      input[field] !== null &&
      !(await delegate(target).findFirst({ where: { id: input[field], vendorId } }))
    )
      throw new ApiError(400, 'INVALID_REFERENCE', 'Appointment reference is unavailable');
  }
}
export async function listResourceRecords(requestInput: ServiceContext) {
  const spec = requestInput.metadata.resource,
    q = requestInput.validatedQuery;
  const where = {
    vendorId: requestInput.identity!.vendorId!,
    ...(modelFields(spec.model).some((f) => f.name === 'deletedAt') ? { deletedAt: null } : {}),
  };
  const [items, total] = await Promise.all([
    delegate(spec.model).findMany({
      where,
      select: projection(spec.model),
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { id: 'desc' },
    }),
    delegate(spec.model).count({ where }),
  ]);
  return serviceResult(
    { items, total, page: q.page, limit: q.limit },
    { status: 200, format: 'json' },
  );
}
export async function getResourceRecord(requestInput: ServiceContext) {
  const spec = requestInput.metadata.resource;
  const id =
    modelFields(spec.model).find((f) => f.name === 'id')?.type === 'Int'
      ? Number(requestInput.params.id)
      : String(requestInput.params.id);
  if (typeof id === 'number' && (!Number.isInteger(id) || id < 1 || id > 2147483647))
    throw new ApiError(400, 'INVALID_ID', 'Invalid identifier');
  const result = await delegate(spec.model).findFirst({
    where: { id, vendorId: requestInput.identity!.vendorId! },
    select: projection(spec.model),
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND', 'Record not found');
  return serviceResult(result, { status: 200, format: 'json' });
}
export async function createResourceRecord(requestInput: ServiceContext) {
  const spec = requestInput.metadata.resource,
    vendorId = requestInput.identity!.vendorId!;
  if (spec.model === 'Labels')
    return serviceResult(await createContactLabel(requestInput, requestInput.body), {
      status: 201,
      format: 'json',
    });
  if (spec.model === 'ContactGroups')
    return serviceResult(await createContactGroup(requestInput, requestInput.body), {
      status: 201,
      format: 'json',
    });
  await validateRelations(spec.model, requestInput.body, vendorId);
  const fields = modelFields(spec.model);
  const data = {
    ...requestInput.body,
    vendorId,
    ...(fields.some((f) => f.name === 'organizationId') ? { organizationId: vendorId } : {}),
    ...(fields.some((f) => f.name === 'createdBy')
      ? { createdBy: requestInput.identity!.userId }
      : {}),
    ...(fields.some((f) => f.name === 'updatedBy')
      ? { updatedBy: requestInput.identity!.userId }
      : {}),
  };
  const result = await delegate(spec.model).create({ data, select: projection(spec.model) });
  await db.auditEvents.create({
    data: {
      vendorId,
      actorId: requestInput.identity!.userId,
      action: 'create',
      resource: spec.model,
      resourceId: String(result.id),
    },
  });
  return serviceResult(result, { status: 201, format: 'json' });
}
export async function updateResourceRecord(requestInput: ServiceContext) {
  const spec = requestInput.metadata.resource,
    vendorId = requestInput.identity!.vendorId!,
    id = Number(requestInput.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647)
    throw new ApiError(400, 'INVALID_ID', 'Invalid identifier');
  if (spec.model === 'Labels')
    return serviceResult(await updateContactLabel(requestInput, id, requestInput.body), {
      status: 200,
      format: 'json',
    });
  if (spec.model === 'ContactGroups')
    return serviceResult(await updateContactGroup(requestInput, id, requestInput.body), {
      status: 200,
      format: 'json',
    });
  await validateRelations(spec.model, requestInput.body, vendorId);
  const result = await delegate(spec.model).findFirst({ where: { id, vendorId } });
  if (!result) throw new ApiError(404, 'NOT_FOUND', 'Record not found');
  const fields = modelFields(spec.model);
  return serviceResult(
    await delegate(spec.model).update({
      where: { id, vendorId },
      data: {
        ...requestInput.body,
        ...(fields.some((f) => f.name === 'updatedAt') ? { updatedAt: new Date() } : {}),
      },
      select: projection(spec.model),
    }),
    { status: 200, format: 'json' },
  );
}
