import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from './contact-administration.service.js';
import { assertContactGroupLinksOwned } from './contact-groups.service.js';
import { contactValue, lockedContactFields } from '../../contacts/services/contact-values.js';
import { aiEntitlementActive } from '../../ai/services/ai-entitlement.service.js';

/** Original web form writes; contact, group links, typed values and audit are one local commit. */
async function write(input: ServiceContext, create: boolean) {
  const vendorId = input.identity!.vendorId!,
    body = input.body;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`legacy-contacts:${vendorId}`},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(603, ${vendorId}::integer)`;
      const previous = create
        ? null
        : await tx.contacts.findFirst({ where: { vendorId, uid: body.contactIdOrUid } });
      if (!create && !previous) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      const existingLinks = previous
        ? await tx.groupContacts.findMany({
            where: { contactId: previous.id },
            select: { groupId: true },
          })
        : [];
      const groupIds: number[] = [
        ...new Set<number>([
          ...existingLinks.map((l) => l.groupId),
          ...(body.contact_groups ?? []),
        ]),
      ].sort((a, b) => a - b);
      if (groupIds.length > 100)
        throw new ApiError(
          409,
          'CONTACT_PROFILE_TOO_LARGE',
          'Reconcile oversized group membership first',
        );
      for (const id of groupIds)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(602, ${id}::integer)`;
      if (previous)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${previous.id}::integer)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${vendorId}::integer)`;
      const permissions = await currentContactPermissions(tx, input);
      const has = (permission: string) =>
        permissions.includes('*') || permissions.includes(permission);
      if (!has(create ? 'vendor.contacts.create' : 'vendor.contacts.edit'))
        throw new ApiError(403, 'FORBIDDEN', 'Contact write permission required');
      if (
        body.contact_groups !== undefined &&
        (!has('vendor.groups.manage') || !has('vendor.chats.view_all'))
      )
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Group replacement requires full group administration',
        );
      if (Object.keys(body.custom_input_fields ?? {}).length && !has('vendor.contacts.edit'))
        throw new ApiError(403, 'FORBIDDEN', 'Custom values require contact edit permission');
      const current = previous
        ? await tx.contacts.findFirst({
            where: {
              id: previous.id,
              vendorId,
              ...(!has('vendor.chats.view_all') ? { assignedUserId: input.identity!.userId } : {}),
            },
          })
        : null;
      if (previous && !current) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      if (current && current.status !== 1)
        throw new ApiError(409, 'CONTACT_INACTIVE', 'Editing requires an active contact');
      if (
        current &&
        body.wab_phone_number_id &&
        body.wab_phone_number_id !== current.wabPhoneNumberId
      )
        throw new ApiError(
          409,
          'PHONE_SCOPE_MISMATCH',
          'Existing contacts cannot move between phone scopes',
        );
      const phoneScope = current?.wabPhoneNumberId ?? body.wab_phone_number_id ?? null;
      if (
        phoneScope &&
        !(await tx.integrationCredentials.findUnique({
          where: {
            vendorId_provider_externalId: {
              vendorId,
              provider: 'whatsapp',
              externalId: phoneScope,
            },
          },
          select: { id: true },
        }))
      )
        throw new ApiError(
          400,
          'INVALID_PHONE_SCOPE',
          'WhatsApp number is not connected to this business',
        );
      const phone = create || has('vendor.contacts.view_phone') ? body.phone_number : undefined;
      if (
        phone !== undefined &&
        (await tx.contacts.findFirst({
          where: { vendorId, waId: phone, ...(current ? { id: { not: current.id } } : {}) },
          select: { id: true },
        }))
      )
        throw new ApiError(409, 'CONTACT_EXISTS', 'Contact phone already exists in this business');
      if (
        body.country != null &&
        !(await tx.countries.findUnique({ where: { id: body.country }, select: { id: true } }))
      )
        throw new ApiError(400, 'INVALID_COUNTRY', 'Country is unavailable');
      const data: Prisma.ContactsUncheckedUpdateInput = {
        updatedAt: new Date(Math.max(Date.now(), current ? current.updatedAt.getTime() + 1 : 0)),
      };
      for (const [source, target] of Object.entries({
        first_name: 'firstName',
        last_name: 'lastName',
        email: 'email',
        language_code: 'languageCode',
      } as const))
        if (body[source] !== undefined)
          data[target] =
            body[source] === '' && ['email', 'language_code'].includes(source)
              ? null
              : body[source];
      if (phone !== undefined) data.waId = phone;
      if (body.country !== undefined) data.countryId = body.country;
      if (body.whatsapp_opt_out !== undefined)
        data.whatsappOptOut = body.whatsapp_opt_out ? 1 : null;
      let enabled: boolean | undefined = body.enable_ai_bot;
      if (create && enabled === undefined) {
        const setting = await tx.vendorSettings.findFirst({
          where: { vendorId, name: 'default_enable_flowise_ai_bot_for_users' },
          select: { value: true },
        });
        enabled = ['1', 'true'].includes(setting?.value ?? '');
      }
      if (body.enable_ai_bot !== undefined && !has('vendor.ai.manage'))
        throw new ApiError(403, 'FORBIDDEN', 'AI management permission required');
      if (
        enabled &&
        current &&
        (current.disableAiBot ||
          (await tx.aiConversationHandoffs.findFirst({
            where: { contactId: current.id, status: { in: ['waiting', 'accepted'] } },
            select: { id: true },
          })))
      )
        throw new ApiError(
          409,
          'AI_RESUME_REQUIRED',
          'Resume paused conversations through the provider-aware resolution workflow',
        );
      if (enabled && !(await aiEntitlementActive(vendorId, tx)))
        throw new ApiError(403, 'AI_ENTITLEMENT_REQUIRED', 'Active AI entitlement required');
      if (enabled !== undefined) data.disableAiBot = enabled ? 0 : 1;
      if (current && body.contact_groups !== undefined) {
        const links = await tx.groupContacts.findMany({
          where: { contactId: current.id },
          select: { groupId: true },
        });
        if (links.some((l) => !groupIds.includes(l.groupId)))
          throw new ApiError(
            409,
            'MEMBERSHIP_CHANGED',
            'Group memberships changed; reload before editing',
          );
        if (
          (await tx.contactGroups.count({
            where: { vendorId, id: { in: links.map((l) => l.groupId) } },
          })) !== links.length
        )
          throw new ApiError(
            409,
            'GROUP_SCOPE_PENDING',
            'Reconcile cross-business imported memberships first',
          );
      }
      if (body.contact_groups !== undefined) {
        const groups = await tx.contactGroups.findMany({
          where: { vendorId, id: { in: body.contact_groups }, status: 1 },
        });
        if (groups.length !== body.contact_groups.length)
          throw new ApiError(400, 'INVALID_GROUP', 'Selected group is unavailable');
        if (groups.some((g) => g.wabPhoneNumberId && g.wabPhoneNumberId !== phoneScope))
          throw new ApiError(
            409,
            'PHONE_SCOPE_MISMATCH',
            'Contact and groups must share phone scope',
          );
        await assertContactGroupLinksOwned(tx, vendorId, groupIds);
      }
      const entries = Object.entries(body.custom_input_fields ?? {}) as [string, string | null][];
      const definitions = entries.length
        ? await tx.contactCustomFields.findMany({
            where: { vendorId, uid: { in: entries.map(([uid]) => uid) } },
          })
        : [];
      if (definitions.length !== entries.length)
        throw new ApiError(400, 'INVALID_FIELD', 'Custom field is unavailable');
      const fields = await lockedContactFields(
        tx,
        vendorId,
        definitions.map((f) => f.id),
      );
      const values = entries.map(([uid, value]) => {
        const definition = definitions.find((f) => f.uid === uid)!;
        return {
          id: definition.id,
          value: contactValue(
            fields.find((f) => f.id === definition.id)!,
            value,
          ),
        };
      });
      const contact = current
        ? await tx.contacts.update({ where: { id: current.id }, data })
        : await tx.contacts.create({
            data: {
              ...(data as Prisma.ContactsUncheckedCreateInput),
              vendorId,
              platform: 'whatsapp',
              wabPhoneNumberId: phoneScope,
              assignedUserId: has('vendor.chats.view_all') ? null : input.identity!.userId,
            },
          });
      if (body.contact_groups !== undefined) {
        await tx.groupContacts.deleteMany({ where: { contactId: contact.id } });
        if (body.contact_groups.length)
          await tx.groupContacts.createMany({
            data: body.contact_groups.map((groupId: number) => ({
              groupId,
              contactId: contact.id,
            })),
          });
      }
      for (const value of values)
        await tx.contactCustomFieldValues.upsert({
          where: {
            contactId_contactCustomFieldsId: {
              contactId: contact.id,
              contactCustomFieldsId: value.id,
            },
          },
          create: {
            contactId: contact.id,
            contactCustomFieldsId: value.id,
            fieldValue: value.value,
          },
          update: { fieldValue: value.value, updatedAt: new Date() },
        });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: input.identity!.userId,
          action: create ? 'create' : 'update',
          resource: 'contact',
          resourceId: String(contact.id),
          metadata: { changedFields: Object.keys(body).filter((k) => k !== 'contactIdOrUid') },
        },
      });
      return serviceResult(
        {
          status: 'success',
          message: create ? 'Contact added.' : 'Contact details updated.',
          contactIdOrUid: contact.uid,
        },
        { status: create ? 201 : 200, format: 'json' },
      );
    },
    { timeout: 30000 },
  );
}
export const create = (input: ServiceContext) => write(input, true);
export const update = (input: ServiceContext) => write(input, false);
