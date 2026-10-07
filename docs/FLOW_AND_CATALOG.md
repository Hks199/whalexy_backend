# Encrypted Flow endpoints and native catalogs

These are native Node contracts. Legacy Blade URLs, session state and response shapes remain unverified. All vendor routes require the existing business-scoped authentication and permission checks. Graph calls in tests are mocked; no live provider account was changed.

## Encrypted Flow setup

Use `/api/v1/vendors/:vendorId/meta-flows/:phoneNumberId` as the prefix. Configure `META_APP_SECRET` and a reachable HTTPS `PUBLIC_URL` first.

1. `POST /encryption-key` with `{}` and `Idempotency-Key` generates RSA-2048 keys. It requires owner access and `vendor.whatsapp_setup.manage`, verifies the actual WABA/phone relationship and refuses to overwrite a provider key. Only the public key and endpoint URI are returned. The private key is encrypted with the application data-encryption key and saved before registration.
2. `GET /encryption-key` retrieves registration status. Matching provider public-key fingerprints and a `VALID` signature can reconcile a completed uncertain/rejected registration. A stale processing registration can be reconciled after five minutes. Mismatched keys remain pending. Pending registration prevents credential deletion. Reconnecting the same number/account preserves its keys.
3. Upload the draft Flow JSON through the existing `PUT /:flowId/json`. Encrypted definitions must declare `data_api_version: "3.0"`, actual screens and a routing model.
4. `PUT /:flowId/data-endpoint` requires owner access, `vendor.bot.manage`, `Idempotency-Key`, a registered number key and a provider draft. It registers the fixed application HTTPS endpoint and saves validated screen rules atomically. `GET /:flowId/data-endpoint` returns the configuration.
5. Publish using the existing Flow publication endpoint, then send using `POST /messages/send` with `kind: "flow"`.

Example data-endpoint configuration for uploaded screens `START` and terminal `CONFIRM`, with routing-model edge `START -> CONFIRM`:

```json
{
  "initialScreen": "START",
  "screens": [
    {
      "id": "START",
      "data": { "title": "Enter your name" },
      "bindings": { "name": "name" },
      "nextScreen": "CONFIRM"
    },
    {
      "id": "CONFIRM",
      "data": { "name": "" },
      "bindings": { "accepted": "accepted" },
      "complete": true
    }
  ]
}
```

Configuration allows up to 100 screens and 50 KB; output fields must match declared Flow data types. Binding keys name completion/output fields and binding values name incoming fields. Bound incoming values are required bounded scalars. Reserved token/prototype keys cannot be bound. Only declared routing-model edges can advance. Terminal status must match uploaded JSON.

`POST /webhooks/flows/:credentialId` precedes application JSON parsing. It verifies the raw-body Meta signature, decrypts RSA-OAEP/SHA-256 and AES-128-GCM input, and returns base64 encrypted plain text with the inverted response IV. Signature failures return 432; decryption failures return 421; invalid/expired sessions return 427 with an encrypted user message. Signed encrypted health/error notifications are supported. Initialization, data exchange, completion and back navigation use bounded persisted sessions, with consecutive duplicate requests replayed under a row lock. Sessions are limited to 100 transitions, 100 KB and the original 24-hour launch-token lifetime. Completion webhooks consume the same token exactly once.

The endpoint executes configured form transitions. Dynamic appointment booking, payment settlement, catalog queries, arbitrary webhooks/scripts, private-key import/rotation and original builder conversion remain separate unfinished workflows. Key-registration uncertainty has provider-based recovery; general Flow mutation recovery still requires implementation. Configuration changes invalidate old launch revisions. A public callback URI alone does not establish live Meta compatibility.

Protocol review uses Meta's first-party [endpoint example](https://github.com/WhatsApp/WhatsApp-Flows-Tools/tree/main/examples/endpoint/nodejs/basic) and [key-registration API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Catalog connections, mirrors and publication

Use `/api/v1/vendors/:vendorId/catalogs` as the prefix.

| Method/path | Request / behavior | Permission |
|---|---|---|
| `GET /` | Safe local catalog summaries | `catalog.view` |
| `POST /connect` | `{businessId,catalogIdExternal,phoneNumberId,currency?}`; owner-only; verifies business ownership, WABA linking and actual phone membership | `catalog.settings.manage` |
| `POST /:catalogId/sync` | `{maxPages?:1..50}`; default 50; validates complete provider snapshot before changing products | `catalog.settings.manage` |
| `GET /:catalogId/products` | `page`, `limit`; safe paginated product summaries | `catalog.view` |
| `POST /:catalogId/products` | Validated draft details | `catalog.products.create` |
| `PUT /:catalogId/products/:productId` | Validated replacement details; published SKU is immutable | `catalog.products.edit` |
| `POST /:catalogId/products/:productId/publish` | `{}`, `Idempotency-Key`; verifies remote ownership for updates, creates/updates through Graph and persists confirmed IDs | `catalog.products.edit` |
| `DELETE /:catalogId/connection` | Owner-only local disconnect; cancels pending sends through dispatch guards; keeps local history | `catalog.settings.manage` |

Tokens are encrypted in the native credential store. The source `catalog_connections.access_token` column stays empty. The connection uses a verified existing WhatsApp credential with sufficient catalog permissions; catalog OAuth/embedded signup remains unported. Another local business cannot claim the same catalog.

Complete snapshots are bounded to 50 pages of 100 products. Truncated snapshots return `CATALOG_SNAPSHOT_INCOMPLETE`; invalid identities, rows, prices or cursors retain prior products. Sync never follows provider pagination URLs. Only complete validated snapshots archive missing mirrored products. Local drafts without provider IDs remain intact. Concurrent reconnect/sync/disconnect changes are guarded before commit. Sync logs retain safe status/error codes.

Mirror prices currently accept unambiguous major-unit decimal strings such as `"12.99 USD"` or `"12.99"`, paired with the provider currency. Ambiguous integer/symbol formats fail for reconciliation. No heuristic guesses between major and minor units. Other provider formats and large resumable catalogs remain unfinished.

Draft request example:

```json
{
  "name": "Example product",
  "sku": "EXAMPLE-1",
  "description": "Product description",
  "price": "12.99",
  "currency": "USD",
  "availability": "in_stock",
  "condition": "new",
  "customUrl": "https://store.example.com/product",
  "primaryImageUrl": "https://store.example.com/image.jpg",
  "brand": "Example brand"
}
```

Publishing currently supports USD, INR, EUR, GBP, CAD and AUD. Prices must resolve to whole minor units within the provider integer bound. HTTPS product/image URLs cannot include credentials. Uncertain publication blocks other idempotency keys for the same product. Confirmed provider results are retained privately if a subsequent local commit fails. Product publication reconciliation, full taxonomy/images/variants/source editors and remote catalog link/unlink management remain pending.

## Catalog messages

`POST /api/v1/vendors/:vendorId/messages/send` accepts:

```json
{
  "contactId": 123,
  "phoneNumberId": "123456789012345",
  "kind": "catalog",
  "catalog": {
    "catalogId": 1,
    "mode": "single",
    "productIds": [7],
    "body": "Browse this product"
  }
}
```

Use `Idempotency-Key`, chat-reply and catalog-view permissions. `single` needs exactly one synchronized visible product; `multiple` needs 1–30; `catalog` allows no product or uses the first selected product as its thumbnail. Selected products must belong to this catalog/business. The actual catalog/WABA link is checked before queuing. The recipient must be visible, active and within the customer service window on the same number.

Messages use the existing durable send, provider acknowledgement and delivery-receipt pipeline. Dispatch rechecks product/connection revisions and sender catalog permission. Disconnects, changed/hidden products or revoked access prevent dispatch. Live commerce delivery and original frontend response contracts remain unverified. Request formats were reviewed against Meta's [multi-product message API](https://www.postman.com/meta/whatsapp-business-platform/request/j1w5o6p/send-multi-product-message) and [Business SDK](https://github.com/facebook/facebook-python-business-sdk).
