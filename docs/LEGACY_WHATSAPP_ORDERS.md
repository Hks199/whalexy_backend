# Original WhatsApp order adapters

Six source declarations have partial adapters:

| Method | Path                                         | Behavior                                   |
| ------ | -------------------------------------------- | ------------------------------------------ |
| GET    | `/vendor-console/whatsapp-orders`            | Safe paginated order JSON                  |
| GET    | `/vendor-console/whatsapp-orders/data`       | Source filter names and pagination         |
| GET    | `/vendor-console/whatsapp-orders/:orderUid`  | Safe order and payment details             |
| GET    | `/vendor-console/whatsapp-orders/statistics` | Tenant order and linked-payment statistics |

Use native bearer authentication and `X-Vendor-Id` when workspace selection is needed. Transactions recheck active user, vendor, membership and API-key permissions. Access requires `vendor.orders.manage` and `vendor.chats.view_all`, or `*`. Phone visibility additionally requires `vendor.contacts.view_phone`.

List inputs are `page` (1–1,000,000), `per_page` (1–100, default 20), `status`, `customer_phone`, `order_id`, `date_from` and `date_to`. Unknown inputs fail validation. Search is literal, filters combine before pagination, and dates are inclusive calendar days in UTC. Phone search requires current phone visibility. List responses contain `{reaction: 1, message: '', data: {orders, filters}}`; `orders` has `data`, `total`, `current_page`, `per_page` and `last_page`.

The detail identifier is the order UUID. Orders that refer to another vendor's or a missing contact are excluded from reads, counts and statistics. Null contact references remain readable within the owning vendor. Detail payments match both the vendor and order ID, with at most 100 newest records. Orphan payments and payments associated with excluded orders do not contribute to statistics.

Projection uses source snake-case names and explicit display fields. Decimal amounts remain exact strings; `final_amount` is `total_amount - discount_amount`, matching the source rule that totals already include tax and shipping. Without phone permission, phones are masked and delivery addresses omitted. Raw order metadata, arbitrary item fields, provider responses, transaction references and payment links remain private. Item arrays and up to two JSON encoding layers are supported; malformed or oversized data requires reconciliation.

Order statistics retain source status buckets. Amounts are exposed through `*_by_currency` dictionaries instead of adding different currencies together. The sums use source total amounts and payment statuses. This response intentionally requires frontend adjustments.

Status writes require `{status, revision}` and an `Idempotency-Key` of 8?100 letters, digits, underscores or hyphens. Reads now project a SHA-256 `revision`. The vendor status lock, order row lock, current authorization, mutation, audit and replay share a transaction. A repeated identical request replays without another audit; changed keys/payloads and stale revisions conflict. Replay responses contain no customer or provider fields.

Pending orders can move to awaiting address/payment or cancellation; awaiting address can move to awaiting payment or cancellation. Awaiting payment can cancel when payments are resolved. Paid orders can confirm, confirmed orders can ship, and shipped orders can deliver. The latter three transitions require completed payment state, exactly one matching completed Razorpay payment with the same currency/final amount, and a processed native capture receipt. Imported/unverified or other-provider payment evidence requires reconciliation. Shipping/delivery set their timestamps. Active payment records or states block cancellation. Direct paid/refunded changes and reversals are rejected. Status writes do not send notifications or overwrite financial fields.

CSV uses the original eleven column headers and the same literal/date/status filters as listing, without pagination arguments. It quotes cells and neutralizes spreadsheet formulas. Phone/address privacy and tenant relationship checks also apply. Up to 10,000 orders are exported; larger exports return a conflict so filters can be narrowed. The response is an attachment named `whatsapp_orders.csv`, with UTC date values and `Cache-Control: no-store`.

Full compatibility remains unverified. Original Blade pages, complete Laravel pagination envelopes, localized/currency labels, source model accessors, contact relations, PDF exports, complete financial/status/provider workflows, payment tests/callback contracts and source timezone/schema/import/live-provider behavior remain pending. These adapters do not mark orders paid, initiate payments or send notifications.

See [tests](../tests/legacy-whatsapp-orders.test.ts) and [API backlog](../migration/API_BACKLOG.md).
