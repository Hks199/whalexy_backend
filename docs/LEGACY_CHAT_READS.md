# Original chat read adapters

Three Laravel web declarations now have partial Node adapters with six concrete paths:

| Method | URL                                                                          | Behavior                                                                          |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/vendor-console/whatsapp/contact/chat-data/:contactUid` and `/:way`         | Paginated message history keyed by message UUID                                   |
| GET    | `/vendor-console/whatsapp/contact/contacts-data` and `/:contactUid`          | Paginated inbox keyed by contact UUID; optionally include a selected conversation |
| GET    | `/vendor-console/whatsapp/contact/chat/prepare-send-media` and `/:mediaType` | Supported upload selection title and media type                                   |

Use native bearer authentication and `X-Vendor-Id` when multiple businesses are available. Reads require `vendor.contacts.view`; preparation requires `vendor.chats.reply`. Reads recheck membership, user/vendor activity and API-key permissions within a repeatable-read transaction. Assigned-only users see their assigned contacts. These endpoints create no sends and do not mark messages read.

History defaults to 16 messages and inbox to 20 contacts per page. `page` is bounded to 1?10000 and `limit` to 1?100. History selects the newest messages by message time then numeric ID and returns each page in chronological display order. `messagePaginatePage` and `contactsPaginatePage` identify the next page or return zero. A selected inbox contact adds at most one extra row and must satisfy the current filters, visibility and sender scope. Missing or empty scoped selected conversations return 404.

`from_phone_number_id` must belong to the business. History defaults to the contact's number, then the sole connected number. Inbox defaults to the sole connected number. Multiple or missing connections require explicit sender selection; a disconnected explicit sender is rejected. Explicit history selection supports retained messages for another owned sender even when the contact currently names a different number. Browser-selected Laravel settings are not inferred.

Inbox accepts `assigned` (`all`, `to-me`, `unassigned`), `unread_only`, `search`, numeric owned `group_id`/`label_id`, UUID `request_contact`, `way` (`append`, `prepend`, `replace`) and sender/page controls. It includes WhatsApp/null/empty-platform contacts with messages for the selected number, ordered by latest scoped message time then contact ID. Counts include only scoped incoming `received` messages. Group and label ownership is checked before filtering. Search treats wildcard characters literally, uses parameterized SQL and includes phone/email only with `vendor.contacts.view_phone`. Hidden identifiers are masked/null in projections. Unassigned filtering never widens an assigned-only user's access.

History exposes source-named ID, text, type, status, incoming flag, timestamps and verified same-business/contact/sender reply UID. Raw `__data`, webhook credentials/tokens, reaction state and provider internals are excluded. Message text is plain text; clients must render it as text. Inbox returns a safe source-named contact projection, latest scoped message timestamp and unread count. It does not serialize full contact models or private contact data.

Preparation defaults to image and supports image, video, audio and document, returning `uploadTitle` and `mediaType`. It does not upload a file or acknowledge remote media delivery. Laravel's FilePond temporary storage and `/chat/send-media` need a separate storage/delivery port.

Original cookie/CSRF and secured envelopes, automatic client model updates, Blade views, translated labels, rich message/quoted reply rendering, media/Flow/calling/template previews, label/handoff/AI summaries, advanced classification filters, realtime and live Laravel/provider comparison remain pending. Unsupported query fields fail validation instead of being silently ignored. Each request uses a consistent database snapshot; pagination across separate requests is not a frozen snapshot. Tests: [legacy-chat-read.test.ts](../tests/legacy-chat-read.test.ts).

The original `GET /vendor-console/whatsapp/chat/unread-count` URL is also available; see [unread count scope and limitations](QUOTED_REPLIES_AND_UNREAD.md).
