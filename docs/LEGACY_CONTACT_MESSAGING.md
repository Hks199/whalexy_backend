# Original contact and messaging URLs

The adapters live inside the contacts and messaging feature folders. All paths below begin with `/api/:vendorUid/contact`, where `vendorUid` is the business UUID. They accept native Bearer sessions or scoped native API keys and require active membership. Original plaintext Laravel tokens, token query parameters and Laravel browser sessions are not supported.

| Method | Path                     | Behavior                                                                                                                                                       |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/create`                | Create a WhatsApp contact, country, groups and typed custom values atomically                                                                                  |
| POST   | `/update/:phoneNumber`   | Resolve an owned visible contact by international phone digits and update supplied fields atomically                                                           |
| POST   | `/send-message`          | Queue a text message using `message_body`                                                                                                                      |
| POST   | `/send-media-message`    | Queue public HTTPS media using `media_type`, `media_url`, optional `message_body`/`caption` and document `file_name`/`filename`                                |
| POST   | `/send-template-message` | Resolve an approved template by `template_name` and `template_language`; map `field_1`, `field_2`, etc. and `header_field_1`, etc. to numbered text parameters |

Contacts accept `phone_number`, `first_name`, `last_name`, `email`, `language_code`, `country`, comma-separated `groups`, `custom_input_fields` keyed by field UUID, `whatsapp_opt_out`, `enable_ai_bot` and optional `from_phone_number_id`. Phone numbers contain the country code without a leading plus or zero. Country identifies one country by name or ISO code. Unknown fields fail validation. Contact success responses use the original `{result, message, data}` envelope with HTTP 200.

Group writes require group management permission and full contact visibility. Custom values require contact edit permission and owned, supported field definitions. Contact, group membership and custom value changes roll back together on failure. Updates preserve omitted groups, opt-out and AI settings. Duplicate recipients require an explicit owned business number; the adapter never chooses an arbitrary conversation. Contact phone output respects native privacy permissions.

Messaging requires chat reply permission, an active base subscription and an `Idempotency-Key` header of 8–100 letters, digits, underscores or hyphens. The recipient must already exist. A supplied `from_phone_number_id`, the contact's business number, or the sole connected number determines the sender. Multiple connected numbers require an explicit selection. Native recipient visibility, customer service window and durable queue/dispatch checks remain in effect.

Message success uses HTTP 202 and `{result:'success',message:'Message queued',data:{log_uid:null,contact_uid,phone_number,wamid:null,status:'queued',message_uid}}`. `message_uid` is the native queued message UUID. A worker must run to deliver it; queue acceptance does not mean provider delivery. Exact accepted requests replay the same queue acknowledgement without adding another job. Template definitions must be synced. Media, button, location, carousel and named template parameters require further conversion and fail explicitly rather than being discarded.

## Remaining compatibility differences

These five routes are partial URL/field adapters, not verified Laravel contracts. Original runtime/frontend/provider tests remain pending. Native authentication, HTTP errors, stricter validation, privacy and permission checks differ from Laravel. Sending does not automatically create a missing contact. Contact creation plan quotas and the original billing catalog still need reconciliation. Original contact updates could remove omitted groups and reset omitted opt-out/AI settings; the adapter deliberately preserves them. The original API could ignore unknown/foreign custom fields; this adapter rejects them and validates supported types. The original message API returned synchronous provider acknowledgements; Node returns honest asynchronous queue acceptance. Template contact-variable substitutions and rich components remain pending. Native contact writers outside these adapters do not share the adapter's vendor duplicate-prevention lock.

Verification: [contact HTTP tests](../tests/legacy-contacts.test.ts), [messaging HTTP tests](../tests/legacy-messaging.test.ts), and existing native message-window/dispatch tests. Provider delivery is not exercised against a live account by these adapter tests.

## Scope of the original API inventory

The original `routes/api.php` declares 35 routes. Nineteen currently have recorded partial URL/field adapters: ten appointments, four knowledge and these five contact/message routes. Sixteen do not yet have recorded adapters: two conversation-analysis routes, five ads-manager routes, two Tally routes, five mobile authentication/contact-data routes, `/api/user` and the API root. Some already have native capabilities under different URLs; this is an adapter count, not an absent-feature count. The remaining source HTTP declarations also include JSON endpoints in `routes/web.php`, views and closures. All 648 source contracts still require full compatibility verification.
