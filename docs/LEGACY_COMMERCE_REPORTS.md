# Original commerce status and statistics APIs

Four original JSON URLs now have partial Node adapters:

| Method | URL                                                  |
| ------ | ---------------------------------------------------- |
| GET    | `/vendor-console/integration/shopify/status`         |
| GET    | `/vendor-console/integration/shopify/statistics`     |
| GET    | `/vendor-console/integration/woocommerce/status`     |
| GET    | `/vendor-console/integration/woocommerce/statistics` |

Use native bearer/workspace authentication and `vendor.integrations.manage`. Each request rechecks current membership/user/vendor/API-key permissions and uses a repeatable-read transaction. Optional positive `integration_id` selects an owned integration. A foreign/missing selection returns 404. Status without a selection returns the disconnected source projection when there is no store and fails with `STORE_SCOPE_REQUIRED` when there are multiple stores; statistics without a selection aggregate all owned stores. Unsupported query fields fail validation.

Shopify status exposes stored `connected`, `shop_domain`, `last_sync`, `webhook_configured` and comma-separated `notification_types`. It requires both the active flag and connection timestamp for `connected`, as the source model does. WooCommerce status exposes stored `connected`, `site_url`, `connected_at` and `last_sync`. Status does not serialize tokens, consumer keys/secrets, webhook IDs/URLs, settings or raw integration data. Invalid stored domains or URLs with credentials/query/hash require reconciliation rather than being returned. These flags describe stored metadata and do not establish provider health.

Shopify statistics return original order and notification keys/rates. Paid orders include `paid`/`partially_paid`; fulfillment includes `fulfilled`/`partial`. Sent notifications include sent/delivered/read, delivered includes delivered/read, and read/failed remain separate. Rates are rounded percentages with zero for an empty denominator.

WooCommerce statistics retain the original `{ success: true, data: ... }` envelope. Paid orders include processing/completed, fulfilled means completed, pending is separate. Sent/failed/pending notification counts are reported. `success_rate` uses notifications created within the previous 30 days and statuses sent/delivered/read; older rows remain in lifetime counts. Neither report sums or mixes currencies.

Order aggregation requires matching business ownership on the order and integration. Notifications require matching ownership on notification/order/integration and, when present, the recipient contact. Imported foreign references cannot contribute to reports. These protections are stricter than source vendor-only queries. Commerce administrators see business aggregates; contact assignment filters are not applied to these integration reports. No provider requests or order/notification writes occur.

Original frontend/session/authorization aliases, translations, exact error behavior, complete imported store/data reconciliation and live Laravel/provider comparison remain pending. Order/detail/notification JSON read models are documented in [commerce history](LEGACY_STORE_HISTORY.md); original page rendering, connect/disconnect and test routes remain pending; guarded resend is documented in [notification retry](LEGACY_STORE_RETRY.md). Existing native delivery workflows are not claimed as compatibility-verified by these read-only reports. Tests: [commerce reports](../tests/legacy-store-reports.test.ts).
