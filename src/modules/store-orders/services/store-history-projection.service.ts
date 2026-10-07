import { ApiError } from '../../../shared/api-error.js';
/** Expose only display fields; provider snapshots and arbitrary item metadata remain private. */
export function orderLineItems(snapshot: unknown) {
  let raw: any = snapshot;
  for (let depth = 0; depth < 2 && typeof raw === 'string'; depth++) {
    if (raw.length > 1000000)
      throw new ApiError(
        409,
        'ORDER_DATA_RECONCILIATION_REQUIRED',
        'Stored order data is too large',
      );
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new ApiError(
        409,
        'ORDER_DATA_RECONCILIATION_REQUIRED',
        'Stored order JSON requires reconciliation',
      );
    }
  }
  if (raw == null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new ApiError(
      409,
      'ORDER_DATA_RECONCILIATION_REQUIRED',
      'Stored order structure requires reconciliation',
    );
  const items = raw.line_items ?? raw.shopify_order_data?.line_items;
  if (items == null) return [];
  if (!Array.isArray(items) || items.length > 1000)
    throw new ApiError(
      409,
      'ORDER_DATA_RECONCILIATION_REQUIRED',
      'Stored line items require reconciliation',
    );
  return items.map((item: any) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity > 1000000
    )
      throw new ApiError(
        409,
        'ORDER_DATA_RECONCILIATION_REQUIRED',
        'Stored line item quantity requires reconciliation',
      );
    const result: Record<string, string | number | null> = { quantity: item.quantity };
    for (const key of ['id', 'product_id', 'variant_id', 'name', 'title', 'sku']) {
      const value = item[key];
      if (value == null) continue;
      if (
        (typeof value !== 'string' &&
          !(typeof value === 'number' && Number.isSafeInteger(value))) ||
        String(value).length > 500 ||
        /[\x00-\x1f]/.test(String(value))
      )
        throw new ApiError(
          409,
          'ORDER_DATA_RECONCILIATION_REQUIRED',
          'Stored line item fields require reconciliation',
        );
      result[key] = String(value);
    }
    for (const key of ['price', 'subtotal', 'total', 'total_tax']) {
      const value = item[key];
      if (value == null) continue;
      if (
        (typeof value !== 'string' && typeof value !== 'number') ||
        !/^\d{1,14}(?:\.\d{1,4})?$/.test(String(value))
      )
        throw new ApiError(
          409,
          'ORDER_DATA_RECONCILIATION_REQUIRED',
          'Stored line item amounts require reconciliation',
        );
      result[key] = String(value);
    }
    return result;
  });
}
