# Original web chat send adapters

Three Laravel web declarations now have partial Node adapters:

| Method | URL                                                                  | Body                                                                                                                                                    |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/vendor-console/whatsapp/contact/chat/send`                         | `contact_uid`, `message_body`, optional `client_message_uid`, `from_phone_number_id`, `reply_to_wamid`                                                  |
| POST   | `/vendor-console/whatsapp/contact/chat/send-location`                | `contact_uid`, `location_type: static`, `location_latitude`, `location_longitude`, optional `location_name`, `location_address`, `from_phone_number_id` |
| POST   | `/vendor-console/whatsapp/contact/chat/message/:messageUid/reaction` | `emoji`; omitted/null/empty removes a reaction                                                                                                          |

Use native bearer authentication and `X-Vendor-Id` for users with multiple businesses. An active base subscription and `vendor.chats.reply` are required. Assigned-only users can send only to visible contacts. Each request requires an 8?100 character `Idempotency-Key` using letters, numbers, underscores or hyphens. Replays share the existing queue record; changed delivery content conflicts.

Text/location select an explicit connected sender, the contact sender, or the sole connected number. Ambiguous fallback is rejected. Reaction sender scope comes from the owned target message and must be reconciled; it never falls back to another number. Native validation, active WhatsApp recipient checks, customer-service window and sender ownership remain enforced. Reactions require a single valid emoji or removal, a recent unambiguous target and no unresolved earlier reaction.

Responses use HTTP 202 with `{ status: "queued", data: { id, uid, status: "queued" } }`. Text echoes a nonempty trimmed browser `client_message_uid`; it is a correlation value, not a delivery idempotency key. The queue records the authenticated sending user. Reaction state changes only after provider acknowledgement through the existing native delivery workflow. Queue acceptance does not prove remote delivery.

Static coordinates are required and bounded to real latitude/longitude ranges. Laravel's live branch only writes a synthetic local message log; this adapter rejects `live` with `LIVE_LOCATION_PENDING` and creates no send/log. Quoted text `reply_to_wamid` now resolves an owned, unambiguous message for the same contact/recipient/sender. The queue preserves provider context and a verified local reply UID, and rechecks the target before dispatch. See [quoted reply guards](QUOTED_REPLIES_AND_UNREAD.md).

These are partial adapters. Original cookies/CSRF, secured response envelopes, browser-selected sender settings, demo behavior, realtime refresh/analysis, full billing rules, translations and original frontend compatibility remain unverified. Native reaction plan/emoji/target/window guards are stricter than source. No live provider or Laravel comparison was performed. Media/template/interactive browser sends require separate adapters. Tests: [legacy-chat-message.test.ts](../tests/legacy-chat-message.test.ts).
