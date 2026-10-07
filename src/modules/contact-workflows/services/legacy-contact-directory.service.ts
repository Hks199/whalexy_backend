import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from './contact-administration.service.js';

/** Safe original DataTables projection over stored contacts; no provider synchronization. */
export async function list(input: ServiceContext) {
  const q = input.validatedQuery,
    vendorId = input.identity!.vendorId!;
  return db.$transaction(
    async (tx) => {
      const permissions = await currentContactPermissions(tx, input);
      const has = (permission: string) =>
        permissions.includes('*') || permissions.includes(permission);
      if (!has('vendor.contacts.view'))
        throw new ApiError(403, 'FORBIDDEN', 'Contact read permission required');
      const showPhone = has('vendor.contacts.view_phone');
      const group = input.params.groupUid
        ? await tx.contactGroups.findFirst({
            where: { vendorId, uid: input.params.groupUid },
            select: { id: true },
          })
        : null;
      if (input.params.groupUid && !group)
        throw new ApiError(404, 'NOT_FOUND', 'Contact group not found');
      if (
        q.from_phone_number_id &&
        !(await tx.integrationCredentials.findUnique({
          where: {
            vendorId_provider_externalId: {
              vendorId,
              provider: 'whatsapp',
              externalId: q.from_phone_number_id,
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
      const base: Prisma.ContactsWhereInput = {
        vendorId,
        ...(!has('vendor.chats.view_all') ? { assignedUserId: input.identity!.userId } : {}),
        ...(group ? { childrenGroupContactsContactId: { some: { groupId: group.id } } } : {}),
        ...(!group && q.platform === 'whatsapp' && q.from_phone_number_id
          ? { wabPhoneNumberId: q.from_phone_number_id }
          : {}),
        ...(q.platform === 'whatsapp'
          ? { OR: [{ platform: null }, { platform: '' }, { platform: 'whatsapp' }] }
          : {
              platform: q.platform === 'facebook' ? { in: ['facebook', 'messenger'] } : 'instagram',
            }),
      };
      const search = q['search[value]'];
      const searchFields = [
        'firstName',
        'lastName',
        ...(showPhone ? ['waId', 'email', 'instagramUsername', 'instagramId', 'facebookId'] : []),
      ];
      const where: Prisma.ContactsWhereInput = search
        ? {
            AND: [
              base,
              {
                OR: searchFields.map((field) => ({
                  [field]: { contains: search, mode: 'insensitive' },
                })),
              },
            ],
          }
        : base;
      const columns: Record<number, string> = {
        2: 'firstName',
        3: 'lastName',
        11: 'email',
        9: 'createdAt',
        12: 'whatsappOptOut',
        13: 'disableAiBot',
      };
      if (!showPhone && q['order[0][column]'] === 11)
        throw new ApiError(403, 'FORBIDDEN', 'Email sorting requires phone visibility');
      const orderBy: Prisma.ContactsOrderByWithRelationInput[] =
        q['order[0][column]'] === undefined
          ? [{ id: 'asc' }]
          : [{ [columns[q['order[0][column]']]]: q['order[0][dir]'] }, { id: 'asc' }];
      const rows = await tx.contacts.findMany({
        where,
        skip: q.start,
        take: q.length,
        orderBy,
        select: {
          id: true,
          uid: true,
          firstName: true,
          lastName: true,
          waId: true,
          email: true,
          platform: true,
          instagramUsername: true,
          instagramId: true,
          facebookId: true,
          languageCode: true,
          countryId: true,
          whatsappOptOut: true,
          disableAiBot: true,
          status: true,
          createdAt: true,
        },
      });
      const recordsTotal = await tx.contacts.count({ where: base }),
        recordsFiltered = await tx.contacts.count({ where });
      const countryIds = [
        ...new Set(rows.flatMap((c) => (c.countryId === null ? [] : [c.countryId]))),
      ];
      const countries = countryIds.length
        ? await tx.countries.findMany({
            where: { id: { in: countryIds } },
            select: { id: true, name: true },
          })
        : [];
      return serviceResult(
        {
          draw: q.draw,
          recordsTotal,
          recordsFiltered,
          data: rows.map((c) => ({
            _id: c.id,
            _uid: c.uid,
            first_name: c.firstName,
            last_name: c.lastName,
            platform: c.platform,
            instagram_username: showPhone ? c.instagramUsername : null,
            instagram_id: showPhone ? c.instagramId : null,
            facebook_id: showPhone ? c.facebookId : null,
            language_code: c.languageCode,
            phone_number: showPhone ? c.waId : c.waId ? '***' + c.waId.slice(-4) : null,
            email: showPhone ? c.email : null,
            country_name: countries.find((country) => country.id === c.countryId)?.name ?? null,
            whatsapp_opt_out: c.whatsappOptOut ? 'Opted Out' : 'Opted In',
            disable_ai_bot: c.disableAiBot ? 'Disabled' : 'Enabled',
            status: c.status,
            created_at: `${String(c.createdAt.getUTCDate()).padStart(2, '0')}/${String(c.createdAt.getUTCMonth() + 1).padStart(2, '0')}/${String(c.createdAt.getUTCFullYear()).slice(-2)}`,
          })),
        },
        { status: 200, format: 'json' },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}
