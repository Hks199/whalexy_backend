import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { can } from '../../../shared/access-policy.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { type ServiceContext } from '../../../shared/service-context.js';
import { csvCell, csvFieldNameAllowed } from '../../contacts/services/contact-csv.js';

export async function prepareContactExport(requestInput: ServiceContext) {
  const extended = requestInput.validatedQuery.extended,
    vendorId = requestInput.identity!.vendorId!;
  const fields = extended
    ? await db.contactCustomFields.findMany({
        where: { vendorId },
        orderBy: { id: 'asc' },
        take: 101,
      })
    : [];
  if (
    fields.length > 100 ||
    fields.some((f) => !csvFieldNameAllowed(f.inputName)) ||
    new Set(fields.map((f) => f.inputName)).size !== fields.length
  )
    throw new ApiError(
      409,
      'FIELD_EXPORT_PENDING',
      'Reconcile custom field names and limits before extended export',
    );
  async function* rows() {
    const headers = [
      'firstName',
      'lastName',
      'phone',
      'email',
      'languageCode',
      ...(extended ? ['countryId', 'groups', ...fields.map((f) => `custom:${f.inputName}`)] : []),
    ];
    yield (extended ? headers.map(csvCell).join(',') : headers.join(',')) + '\r\n';
    let after = 0;
    while (true) {
      const contacts = await db.contacts.findMany({
        where: { ...contactVisibility(requestInput), id: { gt: after } },
        orderBy: { id: 'asc' },
        take: 250,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          waId: true,
          email: true,
          languageCode: true,
          countryId: true,
          wabPhoneNumberId: true,
        },
      });
      if (!contacts.length) break;
      const [values, groups] = extended
        ? await Promise.all([
            db.contactCustomFieldValues.findMany({
              where: {
                contactId: { in: contacts.map((c) => c.id) },
                contactCustomFieldsId: { in: fields.map((f) => f.id) },
                refContactCustomFieldsId: { vendorId },
              },
              select: { contactId: true, contactCustomFieldsId: true, fieldValue: true },
            }),
            db.groupContacts.findMany({
              where: {
                contactId: { in: contacts.map((c) => c.id) },
                refGroupId: { vendorId, status: 1 },
              },
              select: {
                contactId: true,
                refGroupId: { select: { title: true, wabPhoneNumberId: true, id: true } },
              },
              orderBy: { groupId: 'asc' },
            }),
          ])
        : [[], []];
      const show = can(requestInput, 'vendor.contacts.view_phone');
      for (const contact of contacts) {
        const row = [
          contact.firstName,
          contact.lastName,
          contact.waId ? (show ? `+${contact.waId}` : `***${contact.waId.slice(-4)}`) : '',
          show ? contact.email : '',
          contact.languageCode,
        ];
        if (extended)
          row.push(
            contact.countryId === null ? '' : String(contact.countryId),
            JSON.stringify(
              groups
                .filter(
                  (g) =>
                    g.contactId === contact.id &&
                    (!g.refGroupId.wabPhoneNumberId ||
                      g.refGroupId.wabPhoneNumberId === contact.wabPhoneNumberId),
                )
                .map((g) => g.refGroupId.title),
            ),
            ...fields.map((f) =>
              show
                ? (values.find(
                    (v) => v.contactId === contact.id && v.contactCustomFieldsId === f.id,
                  )?.fieldValue ?? '')
                : '',
            ),
          );
        yield row.map(csvCell).join(',') + '\r\n';
      }
      after = contacts[contacts.length - 1].id;
    }
  }
  return rows();
}
