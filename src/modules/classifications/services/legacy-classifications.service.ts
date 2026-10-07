import { DateTime } from 'luxon';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { classificationPresets } from '../../../data/classification-presets.js';
import {
  defaults,
  updateContactClassification,
  createClassificationTag,
} from '../classifications.service.js';

const tag = (row: any) => ({
  _id: row.id,
  _uid: row.uid,
  vendors__id: row.vendorId,
  type: row.type,
  name: row.name,
  color: row.color,
  icon: row.icon,
  category: row.category,
  created_by_users__id: row.createdByUsersId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});
async function contact(input: ServiceContext, uid: string) {
  const row = await db.contacts.findFirst({
    where: { ...contactVisibility(input), uid },
    select: { id: true },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return row;
}
async function data(input: ServiceContext, contactId: number) {
  const vendorId = input.identity!.vendorId!;
  const [classification, tags, logs] = await db.$transaction([
    db.conversationClassifications.findUnique({
      where: { vendorId_contactId: { vendorId, contactId } },
    }),
    db.conversationClassificationTags.findMany({ where: { vendorId }, orderBy: { id: 'asc' } }),
    db.conversationClassificationLogs.findMany({
      where: { vendorId, contactId },
      orderBy: { id: 'desc' },
      take: 30,
    }),
  ]);
  const ids = [
    ...new Set(logs.flatMap((row) => (row.changedByUsersId ? [row.changedByUsersId] : []))),
  ];
  const members = await db.nativeMemberships.findMany({
    where: { vendorId, userId: { in: ids } },
    select: { userId: true },
  });
  const users = await db.users.findMany({
    where: { id: { in: members.map((member) => member.userId) } },
    select: { id: true, firstName: true, lastName: true, name: true },
  });
  const names = new Map(
    users.map((user) => [
      user.id,
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || 'System/Agent',
    ]),
  );
  return {
    classification: {
      intent: classification?.intent ?? defaults.intent,
      sentiment: classification?.sentiment ?? defaults.sentiment,
      urgency: classification?.urgency ?? defaults.urgency,
      risk_level: classification?.riskLevel ?? defaults.riskLevel,
    },
    customTags: tags.map(tag),
    presets: classificationPresets,
    logs: logs.map((row) => ({
      _uid: row.uid,
      type: row.type.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()),
      old_value: row.oldValue || 'None',
      new_value: row.newValue || 'None',
      changed_by: names.get(row.changedByUsersId ?? 0) ?? 'System/Agent',
      created_at: DateTime.fromJSDate(row.createdAt, { zone: 'utc' }).toRelative({ locale: 'en' }),
      formatted_time: DateTime.fromJSDate(row.createdAt, { zone: 'utc' })
        .setLocale('en')
        .toFormat('LLL dd, yyyy hh:mm a'),
    })),
  };
}
export async function logs(input: ServiceContext) {
  const row = await contact(input, input.params.contactUid);
  return serviceResult(
    { reaction: 1, data: await data(input, row.id) },
    { status: 200, format: 'json' },
  );
}
export async function update(input: ServiceContext) {
  const row = await contact(input, input.body.contact_uid);
  await updateContactClassification({
    ...input,
    params: { ...input.params, id: row.id },
    body: { attribute: input.body.attribute, value: input.body.value },
  });
  return serviceResult(
    { reaction: 1, data: await data(input, row.id) },
    { status: 200, format: 'json' },
  );
}
export async function createTag(input: ServiceContext) {
  const result = await createClassificationTag(input),
    row = result.body;
  const tags = await db.conversationClassificationTags.findMany({
    where: { vendorId: input.identity!.vendorId! },
    orderBy: { id: 'asc' },
  });
  return serviceResult(
    {
      reaction: 1,
      message: 'Custom tag created successfully',
      data: { tag: tag(row), customTags: tags.map(tag) },
    },
    { status: 200, format: 'json' },
  );
}
