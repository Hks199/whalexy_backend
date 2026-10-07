import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { baseSubscriptionActive } from '../../billing/services/billing-support.service.js';
import { contactVisibility, visibleContact } from '../../contacts/contacts.service.js';
import { messageSchema } from '../messaging.validation.js';
import { sendMessage } from '../messaging.service.js';
export async function sendLegacyChatMessage(
  input: ServiceContext,
  kind: 'text' | 'location' | 'reaction',
) {
  const vendorId = input.identity!.vendorId!,
    body = input.body;
  if (!(await baseSubscriptionActive(vendorId)))
    throw new ApiError(403, 'SUBSCRIPTION_REQUIRED', 'An active base subscription is required');
  if (kind === 'location' && body.location_type === 'live')
    throw new ApiError(
      409,
      'LIVE_LOCATION_PENDING',
      'Live location delivery requires additional conversion',
    );
  const target =
    kind === 'reaction'
      ? await db.whatsappMessageLogs.findFirst({
          where: { vendorId, uid: input.params.messageUid },
        })
      : null;
  if (kind === 'reaction' && !target?.contactId)
    throw new ApiError(404, 'NOT_FOUND', 'Message not found');
  const contact =
    kind === 'reaction'
      ? await visibleContact(input, target!.contactId!)
      : await db.contacts.findFirst({
          where: { uid: body.contact_uid, ...contactVisibility(input) },
        });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  let phoneNumberId =
    kind === 'reaction'
      ? target!.wabPhoneNumberId
      : (body.from_phone_number_id ?? contact.wabPhoneNumberId);
  if (kind === 'reaction' && !phoneNumberId)
    throw new ApiError(
      409,
      'PHONE_SCOPE_REQUIRED',
      'The target message requires a reconciled business number',
    );
  if (!phoneNumberId) {
    const connections = await db.integrationCredentials.findMany({
      where: { vendorId, provider: 'whatsapp' },
      take: 2,
    });
    if (connections.length !== 1)
      throw new ApiError(
        409,
        'PHONE_SCOPE_REQUIRED',
        'Select one connected business number with from_phone_number_id',
      );
    phoneNumberId = connections[0].externalId;
  }
  const native: Record<string, unknown> = { contactId: contact.id, phoneNumberId, kind };
  if (kind === 'text') {
    native.text = body.message_body;
    if (body.reply_to_wamid) native.replyToWamid = body.reply_to_wamid;
  }
  if (kind === 'location')
    native.location = {
      latitude: body.location_latitude,
      longitude: body.location_longitude,
      ...(body.location_name ? { name: body.location_name } : {}),
      ...(body.location_address ? { address: body.location_address } : {}),
    };
  if (kind === 'reaction') native.reaction = { messageId: target!.id, emoji: body.emoji ?? '' };
  const validated = messageSchema.validate(native, {
    abortEarly: false,
    allowUnknown: false,
    convert: true,
  });
  if (validated.error) throw new ApiError(400, 'VALIDATION_FAILED', 'Message validation failed');
  const queued = await sendMessage({ ...input, body: validated.value });
  return serviceResult(
    {
      status: 'queued',
      data: queued.body,
      ...(kind === 'text' && body.client_message_uid
        ? { client_message_uid: body.client_message_uid }
        : {}),
    },
    { status: 202, format: 'json' },
  );
}
