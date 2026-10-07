# Native WhatsApp reactions

POST `/api/v1/vendors/:vendorId/messages/send` with a vendor session/API key granting `vendor.chats.reply` and an `Idempotency-Key`. Use a visible active WhatsApp contact, its connected business number and the **native message ID**, never a caller-supplied provider ID:

```json
{
  "contactId": 123,
  "phoneNumberId": "123456789",
  "kind": "reaction",
  "reaction": { "messageId": 456, "emoji": "👍🏽" }
}
```

Set `emoji` to `""` to remove your reaction. A nonempty value must be one Unicode RGI emoji sequence, including supported skin-tone, flag or ZWJ sequences. Text, surrounding whitespace and multiple emoji fail validation. Unicode coverage follows the deployed Node runtime. The target must have an unambiguous provider ID, belong to the same vendor/contact/recipient/number, be within 30 days and have editable JSON metadata. Reactions cannot target other reaction logs or failed/cancelled messages. This native API also requires a genuine incoming customer-service window, rechecked before dispatch; that conservative restriction is not evidence of Meta's complete reaction-window behavior.

Returns `202 {id,uid,status:"queued"}`. Reusing the same key/body returns the original queued result; changed content returns 409. One unresolved outgoing reaction per target is allowed. A pending/blocked/uncertain reaction must finish or be reconciled before replacement; an uncertain provider effect must not be blindly retried. Concurrent transactions can return 409 `REACTION_CONFLICT`; retry the identical idempotent request. Existing worker permission, credential, active-vendor and recipient guards apply. Changed/expired targets are cancelled before a provider effect.

Provider acknowledgement merges `data.reactions.self`; empty values remove that key. This is acceptance evidence, not a guarantee of final delivery. Delivery failure receipts remain visible in the outgoing log/outbox; automatic rollback of already accepted reaction metadata is not attempted because the provider state may need reconciliation. Locked merges preserve other JSON and the customer's reaction. Native monotonic self-message IDs prevent a delayed older acknowledgement from replacing a newer accepted change. Sending a reaction does not accept a pending human handoff.

Signed Meta intake merges `data.reactions.contact` only for a unique recent exact target and an existing active owned contact. Raw webhook receipts retain malformed/unknown/ambiguous/foreign-target events; these create no contacts, incoming chat messages, unread increments, away replies, bot transitions or conversation reopening. Reaction events do not extend the customer-service window, including imported logs explicitly typed `reaction`. Intake rejects nonpositive/malformed timestamps, timestamps over five minutes ahead and reactions before the target message (allowing one second for source timestamp rounding).

Contact updates use the customer's reaction timestamp, not webhook arrival order. Older events are ignored. Conflicting events within the same second retain the first processed state and all raw receipts for review; the provider supplies no sequence number to establish their true order. Duplicate event IDs are processed once. Self/contact metadata changes acquire a target row lock to avoid overwriting one another.

## Source and verification limits

Compared with Laravel `WhatsAppServiceEngine::processSendMessageReaction`, incoming reaction handling and `WhatsAppApiService::sendReaction`. Laravel mutates `__data.reactions.self/contact`; native storage preserves that shape but uses asynchronous outbox delivery, stricter recipient/number/ownership checks and explicit ordering evidence. Original Blade calls, route aliases, response envelopes, realtime broadcasts, mark-as-read behavior, source billing/plan enforcement and live provider reaction compatibility remain unverified.

Meta's [reaction send example](https://www.postman.com/meta/whatsapp-business-platform/request/st3lkd6/send-reply-with-reaction-message) identifies the phone-number `/messages` endpoint. Its [reaction webhook reference](https://www.postman.com/meta/whatsapp-business-platform/request/s9dccb2/received-message-with-reaction) documents the 30-day target limit and customer-send timestamp. That webhook example currently spells `messsage_id` incorrectly; this implementation uses `message_id` as in the Laravel source. The current developers.facebook.com reaction page could not be retrieved. Tests use mocked provider requests; these references and native tests do not verify the 647 original route contracts.
