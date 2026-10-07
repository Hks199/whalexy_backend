# Original API adapters added on 2026-10-05

All 35 declarations in the original `routes/api.php` have Node URL adapters. These are **partial compatibility mappings**, not 35 fully verified conversions. Other Laravel route files contain API and frontend contracts that still require review. See [contract progress](../migration/contract-progress.json) and [feature parity](../migration/FEATURE_PARITY.md).

## Conversation analysis

`POST /api/ai/analyze-conversation` accepts `conversation_id` as a contact numeric ID or UUID. `GET /api/ai/conversation-analysis/:conversationId` returns the previous analysis and a generic availability warning when needed. The same relative endpoints are available beneath `/api/v1/vendors/:vendorId/intelligence`.

Use native authentication and a single workspace membership or `X-Vendor-Id`. Analysis requires `vendor.cx.view`, contact assignment visibility, an active base subscription and an active paid/admin AI add-on. POST requires `Idempotency-Key` (8–100 letters, digits, underscores or hyphens). It snapshots the last 100 nonempty text messages, strips markup, and returns HTTP 202. Run the worker to process the durable job; configure `GROQ_API_KEY` and optionally `GROQ_MODEL` in the worker environment. Credentials never appear in responses.

The worker rechecks access and entitlement before sending the transcript and before committing results. Validated scores, summaries, classifications and token usage commit together. A classification edited while the provider runs is preserved. Existing analysis survives invalid results or provider failures. Claimed/uncertain effects cannot automatically repeat, including a database failure after provider acknowledgement. Usage is explicitly unpriced until pricing and billing reconciliation are implemented. The request uses the documented Groq chat endpoint and JSON response format: [official API reference](https://console.groq.com/docs/api-reference).

Original automatic incoming/outgoing triggers, cooldown/cache policy, complete frontend response contracts, live provider proof and uncertain-result reconciliation remain pending. See `tests/conversation-analysis.test.ts`.

## Mobile authentication and contacts

`/api/user/login-process`, `/api/user/prepare-sign-up`, `/api/user/process-sign-up`, `/api/user/logout` and `/api/user` now use the native verification/session workflow. Verified email, username and phone identifiers support legacy password verification and guarded hash upgrades. Ambiguous phone/username identities fail without selecting an arbitrary account. Registration queues verification; it does not immediately log an unverified user in. Current-user responses use an explicit safe field list. Logout revokes all user sessions.

The original signup methods are empty, so the Node signup implementation is a functional extension, not proof of source equivalence. Laravel cookies, encrypted form payloads, remember/session policies and original frontend envelopes remain pending.

`GET /api/vendor/contact/contacts-data` and the optional contact UUID variant return UID-keyed contact maps with pagination. They enforce workspace/assignment/number scope, protect selected contacts, and mask phone/email without permission. Original handoff, Flow, last-message projections and realtime client-model behavior remain pending. The original API root registers its seven explicit methods. See `tests/legacy-mobile.test.ts`.

## Tally

Original UUID vendor `GET /api/:vendorUid/tally/ping` and `POST /api/:vendorUid/tally/send-invoice` map original phone/name/invoice/amount/date aliases to durable template delivery. Conflicting aliases are rejected. The invoice identity deduplicates retries; changed values conflict. Existing owned contacts, a connected WhatsApp number, one approved template, active subscription and reply/integration permissions are required. HTTP 202 acknowledges queueing rather than provider delivery.

Multipart/base64/private PDFs, automatic contacts, source fallback template/text delivery, unrestricted invoice identifiers and complete original synchronous response behavior remain pending. Public document URLs must match the approved template. See `tests/tally.test.ts`.

## AdsManager

The five original UUID vendor paths now provide campaign listing, currency-separated exact reports, local draft creation/actions and immutable conversion recording. Draft creation validates schedule, timezone, budget and special-category targeting and atomically saves the campaign, ad set, creative and ad. Owner sessions, current permissions and `Idempotency-Key` protect draft writes. Local draft duplication, archive and soft deletion replay safely. Existing mirrored campaign pause/resume uses guarded native provider operations.

`publish=true` and the publish action explicitly return `AD_PUBLISH_REVIEW_REQUIRED`. Remote creative upload and campaign/ad-set/creative/ad publication, remote deletion/archive, OAuth, source notifications/envelopes and full frontend compatibility are incomplete. No draft response claims a remote publication. Reports retain separate currencies and decimal strings instead of mixing currency totals or rounding to floats. Conversions require an external identity, supported type/currency, occurrence time and owned campaign/contact UUID. Source optional identities, contact phone aliases, arbitrary attribution/notes and full import reconciliation remain pending. See `tests/legacy-ads.test.ts` and [native AdsManager](ADS_MANAGER.md).
