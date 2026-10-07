# Original classification and CX JSON APIs

These five adapters preserve original Laravel URLs and selected JSON fields. They use native authentication and permissions and remain partial compatibility mappings. Original cookies, CSRF/secured-response handling, Blade views, translated messages and live Laravel/provider comparison are unverified.

Use a native bearer token and either one active workspace membership or an explicit `X-Vendor-Id`. Contact assignment visibility applies to all contact and score reads. Classification history always uses the contact UUID in its URL; a GET request body cannot replace it. Writes require `vendor.cx.manage`; reads require `vendor.cx.view`. The original broad `messaging` permission is not treated as a native permission alias.

| Method | Original path | Supported behavior |
|---|---|---|
| POST | `/vendor-console/whatsapp/chat/classification/update` | `contact_uid`, `attribute`, `value`; updates an owned visible contact and returns classification, tags, presets and history |
| POST | `/vendor-console/whatsapp/chat/classification/tag/create` | `type`, `name`, optional `color`, `icon`, `category`; creates an owned tag and returns it with the updated tag list |
| GET | `/vendor-console/whatsapp/chat/classification/logs/:contactUid` | Defaults or current classification, source presets, owned tags and the latest 30 changes |
| GET | `/vendor-console/cx-analytics/conversations/:conversationId` | Numeric contact ID or UUID; latest resolution's analysis or `not_resolved`; optional `score` selects an owned score for that same contact |
| POST | `/vendor-console/cx-analytics/scores/:scoreId/retry` | Empty JSON body; queues an unavailable `failed` or `pending` score and returns HTTP 202 |

Classification responses use `{reaction: 1, data: ...}`. Classification attributes are `intent`, `sentiment`, `urgency` and `risk_level`. Owned presets/tags are required; arbitrary strings accepted by the original update handler are rejected. Tag colors and icons retain the native validated formats, and duplicate/preset-conflicting names are rejected. Nullable/empty original optional tag fields have stricter native validation. Repeat updates to the same stored value do not add audit rows.

History maps `_uid`, `type`, `old_value`, `new_value`, `changed_by`, `created_at` and `formatted_time`. Missing values become `None`. Actor names are resolved only within the selected workspace; missing or foreign actors become `System/Agent`. Raw tag data, user credentials and provider failure messages are excluded. Timestamps use UTC and English relative/absolute formatting; exact Carbon locale/timezone formatting remains pending.

CX lookup returns `{status, analysis}` with source snake-case score fields, numeric score values and explicit contact/score ownership. It supports the original JSON use case only; the same source route's HTML review view and full agent/dashboard analytics are not ported by this adapter. Provider errors are replaced with a generic unavailable message.

Retry reuses the guarded native score workflow. It serializes requests, cancels superseded pending jobs and leaves one pending retry. Completed/processing/blocked/uncertain scores cannot use the original retry URL; an actively processing job also blocks retries. The narrower allowed-state check occurs inside the native transaction. Native retry endpoints retain their existing explicit recovery policy. HTTP error envelopes/statuses and live scoring/billing/provider reconciliation still differ from Laravel.

Tests: [legacy adapter tests](../tests/legacy-classifications-cx.test.ts), [native classification/CX tests](../tests/classifications-cx.test.ts), and [conversation-analysis concurrency tests](../tests/conversation-analysis.test.ts).
