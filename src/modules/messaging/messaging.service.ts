import { prepareReply } from './services/quoted-reply.service.js';
import { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { digest, opaqueToken } from '../../utils/crypto.js';
import { flowMessage } from '../meta-flows/services/meta-flow-message.js';
import { can } from '../../shared/access-policy.js';
import { catalogMessage } from '../catalogs/services/catalog-messaging.service.js';
import { visibleContact } from '../contacts/contacts.service.js';
import { customerWindowOpen } from './services/whatsapp.js';
import { mediaContent } from './services/media-message.js';
import { interactiveContent } from './services/interactive-message.js';
import { prepareReaction } from './services/reactions.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function sendMessage(requestInput: ServiceContext) {
  const key = requestInput.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key header is required');
  const contact = await visibleContact(requestInput, requestInput.body.contactId),
    vendorId = requestInput.identity!.vendorId!;
  if (
    !contact.waId ||
    contact.status !== 1 ||
    (contact.platform && contact.platform !== 'whatsapp')
  )
    throw new ApiError(400, 'INVALID_CONTACT', 'Contact is not an active WhatsApp recipient');
  if (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== requestInput.body.phoneNumberId)
    throw new ApiError(409, 'PHONE_SCOPE_MISMATCH', 'Contact belongs to another business number');
  const requestHash = digest(JSON.stringify(requestInput.body));
  const previous = await db.nativeIdempotency.findUnique({
    where: { vendorId_key: { vendorId, key } },
  });
  if (previous) {
    if (previous.requestHash !== requestHash)
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for a different request');
    return serviceResult(previous.response, { status: 202, format: 'json' });
  }
  const connection = await db.integrationCredentials.findUnique({
    where: {
      vendorId_provider_externalId: {
        vendorId,
        provider: 'whatsapp',
        externalId: requestInput.body.phoneNumberId,
      },
    },
  });
  if (!connection)
    throw new ApiError(503, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp number is not connected');
  let payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: contact.waId,
  };
  let nativeFlow:
    | {
        id: string;
        revision: number;
        token: string;
      }
    | undefined;
  let nativeCatalog: any;
  let nativeInteractive: ReturnType<typeof interactiveContent> | undefined;
  if (requestInput.body.kind === 'reaction') {
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
  } else if (requestInput.body.kind === 'text') {
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
    payload = {
      ...payload,
      type: 'text',
      text: { body: requestInput.body.text, preview_url: false },
    };
  } else if (requestInput.body.kind === 'location') {
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
    payload = { ...payload, type: 'location', location: requestInput.body.location };
  } else if (requestInput.body.kind === 'media') {
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
    payload = { ...payload, ...mediaContent(requestInput.body.media) };
  } else if (requestInput.body.kind === 'interactive') {
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
    nativeInteractive = interactiveContent(requestInput.body.interactive);
    payload = { ...payload, ...nativeInteractive.content };
  } else if (requestInput.body.kind === 'catalog') {
    if (!can(requestInput, 'catalog.view'))
      throw new ApiError(403, 'FORBIDDEN', 'Catalog permission required');
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
    const built = await catalogMessage(
      vendorId,
      requestInput.body.phoneNumberId,
      requestInput.body.catalog,
    );
    payload = { ...payload, ...built.content };
    nativeCatalog = built.guard;
  } else if (requestInput.body.kind === 'flow') {
    if (
      !(await customerWindowOpen(
        vendorId,
        contact.id,
        requestInput.body.phoneNumberId,
        contact.waId,
      ))
    )
      throw new ApiError(
        409,
        'TEMPLATE_REQUIRED',
        'An approved template is required outside the customer service window',
      );
    const token = opaqueToken(),
      built = await flowMessage(
        vendorId,
        requestInput.body.phoneNumberId,
        requestInput.body.flow.id,
        token,
        requestInput.body.flow.body,
        requestInput.body.flow.cta,
      );
    payload = { ...payload, ...built.content };
    nativeFlow = { id: requestInput.body.flow.id, revision: built.revision, token };
  } else {
    const template = await db.whatsappTemplates.findFirst({
      where: { id: requestInput.body.templateId, vendorId, status: 'APPROVED' },
    });
    if (!template) throw new ApiError(400, 'INVALID_TEMPLATE', 'Approved template not found');
    payload = {
      ...payload,
      type: 'template',
      template: {
        name: template.templateName,
        language: { code: template.languageCode },
        components: requestInput.body.components,
      },
    };
  }
  const result = await db
    .$transaction(
      async (tx) => {
        const old = await tx.nativeIdempotency.findUnique({
          where: { vendorId_key: { vendorId, key } },
        });
        if (old) {
          if (old.requestHash !== requestHash)
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was used for a different request');
          return old.response;
        }
        const nativeReply = requestInput.body.replyToWamid
          ? await prepareReply(tx, vendorId, {
              targetWamid: requestInput.body.replyToWamid,
              contactId: contact.id,
              recipient: contact.waId!,
              phoneNumberId: requestInput.body.phoneNumberId,
            })
          : undefined;
        if (nativeReply)
          payload = { ...payload, context: { message_id: nativeReply.scope.targetWamid } };
        const nativeReaction =
          requestInput.body.kind === 'reaction'
            ? await prepareReaction(tx, vendorId, {
                targetId: requestInput.body.reaction.messageId,
                contactId: contact.id,
                recipient: contact.waId!,
                phoneNumberId: requestInput.body.phoneNumberId,
              })
            : undefined;
        if (nativeReaction)
          payload = {
            ...payload,
            type: 'reaction',
            reaction: {
              message_id: nativeReaction.targetWamid,
              emoji: requestInput.body.reaction.emoji,
            },
          };
        const message = await tx.whatsappMessageLogs.create({
          data: {
            vendorId,
            contactId: contact.id,
            contactWaId: contact.waId,
            message:
              requestInput.body.text ??
              requestInput.body.media?.caption ??
              requestInput.body.interactive?.body ??
              null,
            type:
              requestInput.body.kind === 'media'
                ? requestInput.body.media.type
                : requestInput.body.kind,
            status: 'queued',
            isIncomingMessage: false,
            messagedAt: new Date(),
            wabPhoneNumberId: requestInput.body.phoneNumberId,
            ...(nativeReaction ? { data: { nativeReaction } } : {}),
            ...(nativeReply
              ? {
                  repliedToWhatsappMessageLogsUid: nativeReply.uid,
                  data: { nativeReply: nativeReply.scope },
                }
              : {}),
          },
        });
        const response = { id: message.id, uid: message.uid, status: 'queued' };
        await tx.nativeIdempotency.create({ data: { vendorId, key, requestHash, response } });
        if (nativeInteractive)
          for (const choice of nativeInteractive.choices)
            await tx.nativeIdempotency.create({
              data: {
                vendorId,
                key: `interactive-choice:${choice.tokenHash}`,
                requestHash: digest(`${message.id}:${choice.choiceId}`),
                response: {
                  ...choice,
                  messageId: message.id,
                  contactId: contact.id,
                  recipient: contact.waId,
                  phoneNumberId: requestInput.body.phoneNumberId,
                  expiresAt: nativeInteractive.expiresAt,
                },
              },
            });
        if (nativeFlow)
          await tx.nativeIdempotency.create({
            data: {
              vendorId,
              key: `flow-token:${digest(nativeFlow.token)}`,
              requestHash: digest(`${nativeFlow.id}:${contact.id}`),
              response: {
                flowId: nativeFlow.id,
                revision: nativeFlow.revision,
                contactId: contact.id,
                phoneNumberId: requestInput.body.phoneNumberId,
                expiresAt: Date.now() + 86400000,
              },
            },
          });
        await tx.outboxJobs.create({
          data: {
            vendorId,
            kind: 'whatsapp-send',
            dedupeKey: `send:${vendorId}:${key}`,
            payload: {
              sentByUserId: requestInput.identity!.userId,
              ...(requestInput.identity!.apiKeyId
                ? { apiKeyId: requestInput.identity!.apiKeyId }
                : {}),
              ...(nativeFlow
                ? { nativeFlow: { id: nativeFlow.id, revision: nativeFlow.revision } }
                : {}),
              ...(nativeCatalog ? { nativeCatalog } : {}),
              ...(nativeReaction ? { nativeReaction } : {}),
              ...(nativeReply ? { nativeReply: nativeReply.scope } : {}),
              ...(nativeInteractive
                ? { nativeInteractive: { expiresAt: nativeInteractive.expiresAt } }
                : {}),
              messageId: message.id,
              phoneNumberId: requestInput.body.phoneNumberId,
              payload: payload as Prisma.InputJsonObject,
            },
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error) => {
      if (
        requestInput.body.kind === 'reaction' &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ApiError(
          409,
          'REACTION_CONFLICT',
          'A concurrent reaction changed; retry the same idempotent request',
        );
      throw error;
    });
  return serviceResult(result, { status: 202, format: 'json' });
}
