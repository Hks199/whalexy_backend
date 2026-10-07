# Commerce order and notification history

Six Laravel page URLs now expose partial Node JSON read models:

| Method | URL                                                       |
| ------ | --------------------------------------------------------- |
| GET    | `/vendor-console/integration/shopify/orders`              |
| GET    | `/vendor-console/integration/shopify/orders/:orderId`     |
| GET    | `/vendor-console/integration/shopify/notifications`       |
| GET    | `/vendor-console/integration/woocommerce/orders`          |
| GET    | `/vendor-console/integration/woocommerce/orders/:orderId` |
| GET    | `/vendor-console/integration/woocommerce/notifications`   |

Use native bearer/workspace authentication and `vendor.integrations.manage`. Current permissions are rechecked inside a repeatable-read transaction. These are business commerce administrator reads; contact assignment filters are not applied. Owned store/order/contact relationships are enforced in both rows and counts, and notification reads also enforce recipient/template ownership where present. Foreign imported references are excluded.

All reads accept optional positive `integration_id`, `page` (1?10,000; default 1) and `limit` (1?100; default 50). Lists without store selection span owned stores; details use the provider order ID, not the local database ID. Shopify IDs remain decimal strings up to 40 digits; WooCommerce IDs are positive PostgreSQL integers. Duplicate external IDs across owned stores require selection with HTTP 409; missing or foreign orders/stores return 404.

Order and notification lists accept `status`, literal case-insensitive `search`, and paired `date_from`/`date_to` in valid YYYY-MM-DD form. Dates filter stored creation timestamps and include the entire final UTC day. Filters combine before pagination rather than replacing earlier filters or filtering an already limited collection as in the original controllers. Stable ordering is newest creation timestamp, then local ID. Shopify orders add `financial_status`/`fulfillment_status`; notification type is `notification_type` for Shopify and `type` for WooCommerce. Shopify order search covers number/name/email; WooCommerce covers order number. Notification search covers type and associated order number. Arbitrary customer-JSON search remains pending. Unknown fields, reversed/unpaired dates and excessive bounds fail validation.

Lists return `{orders: {data, total, page, limit, has_more}}` or `{notifications: {data, total, page, limit, has_more}}`. Details return `{order, notifications}` with paginated notification history. Projections use `_id`, `_uid` and snake-case scalar fields, including owned integration/order IDs. Decimal amounts remain strings to preserve precision. No currency amounts are aggregated.

Detail `line_items` includes only quantity, string item/product/variant IDs, name/title/SKU and validated price/subtotal/total/tax values. Raw native snapshots and legacy encoded Shopify `shopify_order_data` wrappers are supported. Lists do not load snapshots. Oversized, malformed or unsafe detail items require reconciliation with HTTP 409. Arbitrary metadata/properties, raw webhook payloads, addresses/customer JSON, notification variables/provider responses/errors/delivery IDs and integration credentials are not serialized. Reads do not refresh providers, mutate orders/messages or mark notifications read.

Laravel originally renders views on these routes. Original page HTML, sessions/roles, translations/errors, customer-address/detail rendering, all filter semantics, imported snapshots and source/provider comparison remain pending. The JSON adapters do not establish full original frontend compatibility or fully verified conversion.

Tests: [commerce history](../tests/legacy-store-history.test.ts).
