import { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';
import { config } from '../../config/environment.js';
import { ApiError } from '../../shared/api-error.js';
import { constantEqual, digest, verifyHmac, decrypt } from '../../utils/crypto.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { headerValue } from '../../utils/headers.js';

export async function persist(
  provider: string,
  eventKey: string,
  payload: Prisma.InputJsonValue,
  vendorId?: number,
  context?: Prisma.InputJsonObject,
) {
  try {
    await db.$transaction(async (tx) => {
      await tx.webhookReceipts.create({ data: { provider, eventKey, payload } });
      await tx.outboxJobs.create({
        data: {
          vendorId,
          kind: `webhook-${provider}`,
          payload: { eventKey, body: payload, ...context },
          dedupeKey: `webhook:${eventKey}`,
        },
      });
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    const previous = await db.webhookReceipts.findFirst({
      where: { eventKey, provider, payload: { equals: payload } },
    });
    if (!previous)
      throw new ApiError(
        409,
        'WEBHOOK_DELIVERY_CONFLICT',
        'Delivery identifier was used for a different event',
      );
  }
}
export async function verifyMetaWebhook(requestInput: ServiceContext) {
  if (
    !config.META_WEBHOOK_VERIFY_TOKEN ||
    requestInput.query['hub.mode'] !== 'subscribe' ||
    typeof requestInput.query['hub.verify_token'] !== 'string' ||
    !constantEqual(requestInput.query['hub.verify_token'], config.META_WEBHOOK_VERIFY_TOKEN) ||
    typeof requestInput.query['hub.challenge'] !== 'string'
  )
    throw new ApiError(403, 'INVALID_VERIFICATION', 'Webhook verification failed');
  return serviceResult(requestInput.query['hub.challenge'], {
    status: 200,
    format: 'send',
    contentType: 'text/plain',
  });
}
export async function handleMetaWebhook(requestInput: ServiceContext) {
  if (!Buffer.isBuffer(requestInput.body))
    throw new ApiError(400, 'INVALID_CONTENT_TYPE', 'JSON content type required');
  const signature =
    headerValue(requestInput.headers, 'x-hub-signature-256')?.replace(/^sha256=/, '') ?? '';
  if (!verifyHmac(requestInput.body, signature, config.META_APP_SECRET))
    throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  let payload;
  try {
    payload = JSON.parse(requestInput.body.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON');
  }
  if (
    !['whatsapp_business_account', 'page', 'instagram'].includes(payload.object) ||
    !Array.isArray(payload.entry)
  )
    throw new ApiError(400, 'INVALID_WEBHOOK', 'Unsupported webhook envelope');
  await persist('meta', `meta:${digest(requestInput.body)}`, payload);
  return serviceResult({ received: true }, { status: 200, format: 'json' });
}
export async function handleStoreWebhook(requestInput: ServiceContext) {
  if (!['shopify', 'woocommerce'].includes(String(requestInput.params.provider)))
    throw new ApiError(404, 'NOT_FOUND', 'Webhook provider not found');
  if (!Buffer.isBuffer(requestInput.body))
    throw new ApiError(400, 'INVALID_CONTENT_TYPE', 'JSON content type required');
  const c = await db.integrationCredentials.findFirst({
    where: {
      id: String(requestInput.params.credentialId),
      provider: String(requestInput.params.provider),
    },
  });
  if (!c) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  const signature =
    headerValue(
      requestInput.headers,
      c.provider === 'shopify' ? 'x-shopify-hmac-sha256' : 'x-wc-webhook-signature',
    ) ?? '';
  if (!verifyHmac(requestInput.body, signature, decrypt(c.secret), 'base64'))
    throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  let body;
  try {
    body = JSON.parse(requestInput.body.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON');
  }
  const topic = headerValue(
    requestInput.headers,
    c.provider === 'shopify' ? 'x-shopify-topic' : 'x-wc-webhook-topic',
  );
  if (!topic || topic.length > 100 || !/^[a-z][a-z0-9_.\/-]+$/.test(topic))
    throw new ApiError(400, 'INVALID_STORE_TOPIC', 'Store webhook topic is required');
  const shop = headerValue(requestInput.headers, 'x-shopify-shop-domain');
  if (c.provider === 'shopify' && shop && shop.toLowerCase() !== c.externalId)
    throw new ApiError(
      400,
      'STORE_IDENTITY_MISMATCH',
      'Webhook shop does not match its connection',
    );
  const delivery = headerValue(
    requestInput.headers,
    c.provider === 'shopify' ? 'x-shopify-webhook-id' : 'x-wc-webhook-delivery-id',
  );
  if (delivery && !/^[A-Za-z0-9_-]{1,200}$/.test(delivery))
    throw new ApiError(400, 'INVALID_DELIVERY_ID', 'Invalid store delivery identifier');
  const eventKey = `${c.provider}:${c.id}:${topic}:${delivery ?? digest(requestInput.body)}`;
  await persist(c.provider, eventKey, body, c.vendorId, {
    credentialId: c.id,
    topic,
    bodyHash: digest(requestInput.body),
  });
  return serviceResult({ received: true }, { status: 200, format: 'json' });
}
export async function handlePaymentWebhook(requestInput: ServiceContext) {
  const p = String(requestInput.params.provider);
  if (!Buffer.isBuffer(requestInput.body))
    throw new ApiError(400, 'INVALID_CONTENT_TYPE', 'JSON content type required');
  if (p === 'razorpay') {
    if (
      !verifyHmac(
        requestInput.body,
        headerValue(requestInput.headers, 'x-razorpay-signature') ?? '',
        process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
      )
    )
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  } else if (p === 'stripe') {
    const sig = headerValue(requestInput.headers, 'stripe-signature') ?? '',
      timestamp = sig.match(/(?:^|,)t=(\d+)/)?.[1],
      signatures = [...sig.matchAll(/(?:^|,)v1=([a-f0-9]{64})/g)].map((m) => m[1]);
    if (
      !timestamp ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !signatures.some((s) =>
        verifyHmac(
          Buffer.concat([Buffer.from(`${timestamp}.`), requestInput.body]),
          s,
          process.env.STRIPE_WEBHOOK_SECRET ?? '',
        ),
      )
    )
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  } else throw new ApiError(404, 'NOT_FOUND', 'Payment provider not found');
  let body;
  try {
    body = JSON.parse(requestInput.body.toString('utf8'));
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_WEBHOOK', 'Payment event object is required');
  if (p === 'stripe' && (typeof body.id !== 'string' || !/^evt_[A-Za-z0-9]{1,200}$/.test(body.id)))
    throw new ApiError(400, 'INVALID_WEBHOOK', 'Stripe event identifier is required');
  await persist(p, `${p}:${p === 'stripe' ? body.id : digest(requestInput.body)}`, body);
  return serviceResult({ received: true }, { status: 200, format: 'json' });
}
