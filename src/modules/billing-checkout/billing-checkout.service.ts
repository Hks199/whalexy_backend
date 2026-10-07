import { db } from '../../database/client.js';
import { config } from '../../config/environment.js';
import { ApiError } from '../../shared/api-error.js';
import {
  stripeConfigured,
  stripeOperation,
  providerId,
  stripeUrl,
} from '../../infrastructure/providers/stripe.client.js';
import { planSchema } from './billing-checkout.validation.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { headerValue } from '../../utils/headers.js';

export type BillingPlan = {
  id: string;
  title: string;
  priceId: string;
  interval: string;
  amount: number;
  currency: string;
  manualPayments?: boolean;
};
export function billingPlans(): BillingPlan[] {
  let raw;
  try {
    raw = JSON.parse(process.env.BILLING_PLANS ?? '[]');
  } catch {
    throw new ApiError(
      503,
      'BILLING_PLANS_NOT_CONFIGURED',
      'Billing plans need valid configuration',
    );
  }
  const result = planSchema.validate(raw);
  if (result.error)
    throw new ApiError(
      503,
      'BILLING_PLANS_NOT_CONFIGURED',
      'Billing plans need valid configuration',
    );
  return result.value;
}
export function owner(req: ServiceContext) {
  if (req.identity!.role !== 'owner' || req.identity!.apiKeyId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the business owner can manage billing');
}
export function requestKey(req: ServiceContext, prefix: string) {
  const key = headerValue(req.headers, 'Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  return `${prefix}:${key}`;
}
export async function customer(vendorId: number) {
  const vendor = await db.vendors.findUniqueOrThrow({
    where: { id: vendorId },
    select: { stripeId: true, title: true, uid: true },
  });
  if (vendor.stripeId) {
    providerId(vendor.stripeId, 'cus');
    if ((await db.vendors.count({ where: { stripeId: vendor.stripeId } })) !== 1)
      throw new ApiError(409, 'CUSTOMER_OWNER_MISMATCH', 'Billing customer is ambiguous');
    return vendor.stripeId;
  }
  // Name comes from this durable request once; business edits cannot change retries.
  const result = await stripeOperation(
    vendorId,
    'stripe:customer',
    { 'metadata[vendor_uid]': vendor.uid },
    '/customers',
    (r) => providerId(r.id, 'cus'),
  );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-customer:${result.id}`},0))`;
    if (
      await tx.vendors.findFirst({
        where: { stripeId: result.id, id: { not: vendorId } },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'CUSTOMER_OWNER_MISMATCH',
        'Billing customer belongs to another business',
      );
    const current = await tx.vendors.findUniqueOrThrow({
      where: { id: vendorId },
      select: { stripeId: true },
    });
    if (current.stripeId && current.stripeId !== result.id)
      throw new ApiError(
        409,
        'CUSTOMER_OWNER_MISMATCH',
        'Billing customer changed during checkout',
      );
    await tx.vendors.update({
      where: { id: vendorId },
      data: { stripeId: result.id, updatedAt: new Date() },
    });
    return result.id as string;
  });
}
export async function listBillingPlans(requestInput: ServiceContext) {
  return serviceResult(
    {
      stripeConfigured: stripeConfigured(),
      plans: billingPlans().map(({ priceId, ...plan }) => plan),
    },
    { status: 200, format: 'json' },
  );
}
export async function createCheckoutSession(requestInput: ServiceContext) {
  owner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    key = requestKey(requestInput, 'stripe:checkout'),
    plan = billingPlans().find((p) => p.id === requestInput.body.planId);
  if (!plan) throw new ApiError(400, 'INVALID_PLAN', 'Plan is not available');
  const prior = await db.nativeIdempotency.findUnique({
    where: { vendorId_key: { vendorId, key } },
  });
  if (
    !prior &&
    (await db.manualSubscriptions.findFirst({
      where: {
        vendorId,
        OR: [
          { status: { in: ['initiated', 'pending'] } },
          { status: 'active', OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        ],
      },
      select: { id: true },
    }))
  )
    throw new ApiError(
      409,
      'MANUAL_SUBSCRIPTION_EXISTS',
      'Resolve the manual payment or subscription before starting checkout',
    );
  if (
    !prior &&
    (await db.subscriptions.findFirst({
      where: {
        vendorId,
        type: { not: 'addon_ai_replies' },
        stripeStatus: { in: ['active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused'] },
      },
      select: { id: true },
    }))
  )
    throw new ApiError(
      409,
      'SUBSCRIPTION_EXISTS',
      'Manage the existing subscription through the billing portal',
    );
  const customerId = await customer(vendorId),
    base = config.PUBLIC_URL.replace(/\/$/, '');
  const parameters = {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: String(vendorId),
    'metadata[vendor_id]': String(vendorId),
    'metadata[plan_id]': plan.id,
    'subscription_data[metadata][type]': plan.id,
    success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing/cancel`,
  };
  const result = await stripeOperation(vendorId, key, parameters, '/checkout/sessions', (r) => {
    providerId(r.id, 'cs');
    stripeUrl(r.url, 'checkout.stripe.com');
    if (r.customer !== customerId || r.mode !== 'subscription')
      throw new ApiError(502, 'PROVIDER_RESPONSE', 'Checkout does not match this business');
  });
  return serviceResult(
    { id: result.id, url: result.url, expiresAt: result.expires_at ?? null },
    { status: 201, format: 'json' },
  );
}
export async function createBillingPortalSession(requestInput: ServiceContext) {
  owner(requestInput);
  const vendorId = requestInput.identity!.vendorId!,
    key = requestKey(requestInput, 'stripe:portal');
  const customerId = (
    await db.vendors.findUniqueOrThrow({ where: { id: vendorId }, select: { stripeId: true } })
  ).stripeId;
  if (!customerId || (await db.vendors.count({ where: { stripeId: customerId } })) !== 1)
    throw new ApiError(409, 'CUSTOMER_OWNER_MISMATCH', 'A unique billing customer is required');
  const result = await stripeOperation(
    vendorId,
    key,
    {
      customer: providerId(customerId, 'cus'),
      return_url: `${config.PUBLIC_URL.replace(/\/$/, '')}/billing`,
    },
    '/billing_portal/sessions',
    (r) => {
      providerId(r.id, 'bps');
      stripeUrl(r.url, 'billing.stripe.com');
    },
  );
  return serviceResult({ url: result.url }, { status: 201, format: 'json' });
}
export async function listBillingInvoices(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    customerId = (
      await db.vendors.findUniqueOrThrow({ where: { id: vendorId }, select: { stripeId: true } })
    ).stripeId;
  if (!customerId)
    return serviceResult(
      { items: [], hasMore: false, nextCursor: null },
      { status: 200, format: 'json' },
    );
  if ((await db.vendors.count({ where: { stripeId: customerId } })) !== 1)
    throw new ApiError(409, 'CUSTOMER_OWNER_MISMATCH', 'Billing customer is ambiguous');
  // Customer filtering is encoded as a separate fixed endpoint request, never a user-supplied path.
  const { providerRequest } = await import('../../infrastructure/providers/meta.client.js');
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new ApiError(503, 'STRIPE_NOT_CONFIGURED', 'Stripe billing is not configured');
  const q = requestInput.validatedQuery,
    url = new URL('https://api.stripe.com/v1/invoices');
  url.searchParams.set('customer', providerId(customerId, 'cus'));
  url.searchParams.set('limit', String(q.limit));
  if (q.startingAfter) url.searchParams.set('starting_after', q.startingAfter);
  const result = await providerRequest(url, { headers: { Authorization: `Bearer ${secret}` } });
  if (
    !Array.isArray(result.data) ||
    result.data.length > q.limit ||
    typeof result.has_more !== 'boolean' ||
    result.data.some((r: any) => r.customer !== customerId) ||
    (result.has_more && !result.data.length)
  )
    throw new ApiError(502, 'PROVIDER_RESPONSE', 'Invalid customer invoice list');
  const ids = result.data.map((r: any) => providerId(r.id, 'in'));
  if (new Set(ids).size !== ids.length || ids.includes(q.startingAfter))
    throw new ApiError(502, 'PROVIDER_PAGINATION', 'Repeated invoice cursor or identifier');
  return serviceResult(
    {
      items: result.data.map((r: any) => ({
        id: r.id,
        status: r.status,
        currency: r.currency,
        total: r.total,
        paid: r.paid,
        created: r.created,
        hostedUrl: r.hosted_invoice_url ?? null,
        pdfUrl: r.invoice_pdf ?? null,
      })),
      hasMore: result.has_more,
      nextCursor: result.has_more ? ids.at(-1) : null,
    },
    { status: 200, format: 'json' },
  );
}
