import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { digest } from '../../../utils/crypto.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
export const select = {
  id: true,
  uid: true,
  orderId: true,
  contactId: true,
  customerPhone: true,
  customerName: true,
  items: true,
  totalAmount: true,
  taxAmount: true,
  shippingAmount: true,
  discountAmount: true,
  deliveryAddress: true,
  status: true,
  paymentStatus: true,
  currency: true,
  orderedAt: true,
  paymentCompletedAt: true,
  shippedAt: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WhatsappOrdersSelect;
export async function access(tx: Prisma.TransactionClient, input: ServiceContext) {
  const p = await currentContactPermissions(tx, input);
  const has = (key: string) => p.includes('*') || p.includes(key);
  if (!has('vendor.orders.manage') || !has('vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Order management and full contact visibility required');
  return { vendorId: input.identity!.vendorId!, phone: has('vendor.contacts.view_phone') };
}
export function scope(vendorId: number) {
  return Prisma.sql`o.vendors__id=${vendorId} AND (o.contacts__id IS NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c._id=o.contacts__id AND c.vendors__id=${vendorId}))`;
}
export function filter(vendorId: number, q: any) {
  const parts = [scope(vendorId)];
  if (q.status) parts.push(Prisma.sql`o.status=${q.status}`);
  if (q.customer_phone) parts.push(Prisma.sql`strpos(o.customer_phone,${q.customer_phone})>0`);
  if (q.order_id) parts.push(Prisma.sql`strpos(o.order_id,${q.order_id})>0`);
  if (q.date_from)
    parts.push(
      Prisma.sql`o.created_at>=(${new Date(q.date_from + 'T00:00:00Z')}::timestamptz AT TIME ZONE 'UTC')`,
    );
  if (q.date_to)
    parts.push(
      Prisma.sql`o.created_at<(${new Date(new Date(q.date_to + 'T00:00:00Z').valueOf() + 86400000)}::timestamptz AT TIME ZONE 'UTC')`,
    );
  return Prisma.join(parts, ' AND ');
}
function safeItems(raw: unknown) {
  let value: any = raw;
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    if (value.length > 1000000)
      throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Order items require reconciliation');
    try {
      value = JSON.parse(value);
    } catch {
      throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Order items require reconciliation');
    }
  }
  if (!Array.isArray(value) || value.length > 1000)
    throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Order items require reconciliation');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Invalid order item');
    const result: Record<string, unknown> = {};
    for (const key of [
      'product_retailer_id',
      'retailer_id',
      'name',
      'title',
      'currency',
      'quantity',
      'item_price',
      'price',
    ]) {
      if (item[key] === undefined) continue;
      const val = item[key];
      if (
        (typeof val !== 'string' && typeof val !== 'number') ||
        String(val).length > 500 ||
        /[\x00-\x1f]/.test(String(val))
      )
        throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Invalid order item');
      if (
        key === 'quantity' &&
        (!Number.isInteger(Number(val)) || Number(val) < 0 || Number(val) > 1000000)
      )
        throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Invalid quantity');
      if (
        ['price', 'item_price'].includes(key) &&
        (!/^\d+(?:\.\d{1,4})?$/.test(String(val)) || String(val).length > 24)
      )
        throw new ApiError(409, 'ORDER_REVIEW_REQUIRED', 'Invalid item price');
      result[key] = val;
    }
    return result;
  });
}
export function revision(row: any) {
  return digest(JSON.stringify(row));
}
export function projection(row: any, phone: boolean) {
  return {
    revision: revision(row),
    _id: row.id,
    _uid: row.uid,
    order_id: row.orderId,
    customer_phone: phone
      ? row.customerPhone
      : '****' + (row.customerPhone.length > 4 ? row.customerPhone.slice(-4) : ''),
    customer_name: row.customerName,
    items: safeItems(row.items),
    total_amount: row.totalAmount.toString(),
    tax_amount: row.taxAmount.toString(),
    shipping_amount: row.shippingAmount.toString(),
    discount_amount: row.discountAmount.toString(),
    // Source total_amount already contains tax and shipping.
    final_amount: row.totalAmount.sub(row.discountAmount).toString(),
    status: row.status,
    payment_status: row.paymentStatus,
    currency: row.currency,
    ordered_at: row.orderedAt,
    payment_completed_at: row.paymentCompletedAt,
    shipped_at: row.shippedAt,
    delivered_at: row.deliveredAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    ...(phone ? { delivery_address: row.deliveryAddress } : {}),
  };
}
export function result(data: any) {
  return serviceResult({ reaction: 1, message: '', data }, { status: 200, format: 'json' });
}
