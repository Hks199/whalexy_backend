# Legacy standalone bot reply adapters

Six Laravel declarations now have partial Node adapters under `/vendor-console/bot-replies`.

| Method | Path                                   | Supported behavior                                                                             |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/list-data`                           | Tenant-scoped, bounded DataTables text fields, literal search, supported single-column sorting |
| GET    | `/{botReplyIdOrUid}/get-update-data`   | Plain standalone reply edit fields                                                             |
| POST   | `/add-process`                         | Create a text reply using original snake-case fields                                           |
| POST   | `/update-process`                      | Update via body `botReplyIdOrUid`                                                              |
| POST   | `/{botReplyIdOrUid}/duplicate-process` | Create a distinct disabled text copy                                                           |
| POST   | `/{botReplyIdOrUid}/delete-process`    | Delete an owned standalone reply without dependent bot links                                   |

Authentication uses the native workspace bearer token and current `vendor.bot.manage` permission, checked again inside transactions. Writes require `Idempotency-Key` (8?100 letters, digits, underscores or hyphens). Reusing the same key/body returns the saved response; different payloads conflict. Audit, mutation and replay state commit together. Concurrent configuration changes return a retryable conflict. Writes follow the same field-definition and bot locks as native text replies.

Create/update accept `name`, `trigger_type`, `reply_trigger`, `reply_text`, optional `message_type` equal to `simple`, checkbox `status`, optional `phone_number_id`, and `validate_bot_reply` equal to false. Omitted status disables the reply. Update retains existing sender selection when omitted. Selecting a sender requires an owned connected WhatsApp credential. Native trigger/pattern validation and the 200-rule limit also apply. Duplicate validates configuration and starts disabled, requiring explicit activation.

Lists return `draw`, `recordsTotal`, `recordsFiltered`, and `data`; default length is 25, maximum 100. Bounded bracket-form DataTables search/column/order fields are normalized with the existing simple query parser. Unsupported sort names, column-specific search, regex search and unbounded lengths fail. Projected records use original `_id`, `_uid`, `name`, `reply_text`, `reply_trigger`, `trigger_type`, `status`, `created_at`, `updated_at`. Dates are ISO strings and trigger labels are raw codes. Rich metadata never appears in legacy list responses.

Imported metadata, linked replies and flow nodes cannot be edited/copied/deleted through these text adapters. The shared native update/delete path also preserves rich metadata. Existing queued text sends still revalidate rule status/revision before dispatch, so edits or deletion cancel stale sends.

These are **partial URL/field adapters**, not verified full conversions. Flow-node creation/updates/context duplication, interactive/media/template/catalog/Flow nodes, send-test effects, legacy selector lists/client models/HTML, labels/locales, session roles/demo modes, plan billing quotas and imported schema/runtime/provider comparisons remain pending. See [contract progress](../migration/contract-progress.json) and [API backlog](../migration/API_BACKLOG.md).
