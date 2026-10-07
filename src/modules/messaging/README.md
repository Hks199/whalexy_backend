# messaging

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                  | Mounted prefix                          |
| ----------------------- | --------------------------------------- |
| legacyChatMessageRouter | `/vendor-console/whatsapp/contact/chat` |
| legacyChatReadRouter    | `/vendor-console/whatsapp/contact`      |
| legacyUnreadRouter      | `/vendor-console/whatsapp`              |
| legacyMessagingRouter   | `/api/:vendorUid/contact`               |
| messagingRouter         | `/api/v1/vendors/:vendorId/messages`    |

## Files to read

### Routes

- [legacy-chat-message.routes.ts](legacy-chat-message.routes.ts)
- [legacy-chat-read.routes.ts](legacy-chat-read.routes.ts)
- [legacy-messaging.routes.ts](legacy-messaging.routes.ts)
- [messaging.routes.ts](messaging.routes.ts)

### Controllers

- [legacy-chat-message.controller.ts](legacy-chat-message.controller.ts)
- [legacy-chat-read.controller.ts](legacy-chat-read.controller.ts)
- [legacy-messaging.controller.ts](legacy-messaging.controller.ts)
- [messaging.controller.ts](messaging.controller.ts)

### Validation

- [legacy-chat-message.validation.ts](legacy-chat-message.validation.ts)
- [legacy-chat-read.validation.ts](legacy-chat-read.validation.ts)
- [legacy-messaging.validation.ts](legacy-messaging.validation.ts)
- [messaging.validation.ts](messaging.validation.ts)

### Services and domain helpers

- [messaging.service.ts](messaging.service.ts)
- [services/interactive-message.ts](services/interactive-message.ts)
- [services/legacy-chat-message.service.ts](services/legacy-chat-message.service.ts)
- [services/legacy-chat-read.service.ts](services/legacy-chat-read.service.ts)
- [services/legacy-messaging.service.ts](services/legacy-messaging.service.ts)
- [services/media-message.ts](services/media-message.ts)
- [services/quoted-reply.service.ts](services/quoted-reply.service.ts)
- [services/reactions.ts](services/reactions.ts)
- [services/whatsapp.ts](services/whatsapp.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                  | Method | Relative path                                                         | Controller                |
| ----------------------- | ------ | --------------------------------------------------------------------- | ------------------------- |
| legacyChatMessageRouter | POST   | `/send`                                                               | text                      |
| legacyChatMessageRouter | POST   | `/send-location`                                                      | location                  |
| legacyChatMessageRouter | POST   | `/message/:messageUid/reaction`                                       | reaction                  |
| legacyChatReadRouter    | GET    | `['/chat-data/:contactUid', '/chat-data/:contactUid/:way']`           | history                   |
| legacyChatReadRouter    | GET    | `['/contacts-data', '/contacts-data/:contactUid']`                    | inbox                     |
| legacyChatReadRouter    | GET    | `['/chat/prepare-send-media', '/chat/prepare-send-media/:mediaType']` | prepare                   |
| legacyUnreadRouter      | GET    | `/chat/unread-count`                                                  | unread                    |
| legacyMessagingRouter   | POST   | `/send-message`                                                       | sendLegacyTextMessage     |
| legacyMessagingRouter   | POST   | `/send-media-message`                                                 | sendLegacyMediaMessage    |
| legacyMessagingRouter   | POST   | `/send-template-message`                                              | sendLegacyTemplateMessage |
| messagingRouter         | POST   | `/send`                                                               | sendMessage               |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [advanced-interactive.test.ts](../../../tests/advanced-interactive.test.ts)
- [bot-catalogs.test.ts](../../../tests/bot-catalogs.test.ts)
- [bot-meta-flows.test.ts](../../../tests/bot-meta-flows.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [campaign-workflows.test.ts](../../../tests/campaign-workflows.test.ts)
- [catalogs.test.ts](../../../tests/catalogs.test.ts)
- [classifications-cx.test.ts](../../../tests/classifications-cx.test.ts)
- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [contact-data.test.ts](../../../tests/contact-data.test.ts)
- [contact-fields.test.ts](../../../tests/contact-fields.test.ts)
- [contact-lifecycle.test.ts](../../../tests/contact-lifecycle.test.ts)
- [flow-data.test.ts](../../../tests/flow-data.test.ts)
- [interactive-messaging.test.ts](../../../tests/interactive-messaging.test.ts)
- [legacy-campaign.test.ts](../../../tests/legacy-campaign.test.ts)
- [legacy-chat-message.test.ts](../../../tests/legacy-chat-message.test.ts)
- [legacy-chat-read.test.ts](../../../tests/legacy-chat-read.test.ts)
- [legacy-classifications-cx.test.ts](../../../tests/legacy-classifications-cx.test.ts)
- [legacy-contact-assignment.test.ts](../../../tests/legacy-contact-assignment.test.ts)
- [legacy-contact-bulk-delete.test.ts](../../../tests/legacy-contact-bulk-delete.test.ts)
- [legacy-contact-directory.test.ts](../../../tests/legacy-contact-directory.test.ts)
- [legacy-contact-fields.test.ts](../../../tests/legacy-contact-fields.test.ts)
- [legacy-contact-groups.test.ts](../../../tests/legacy-contact-groups.test.ts)
- [legacy-contact-memberships.test.ts](../../../tests/legacy-contact-memberships.test.ts)
- [legacy-contact-profile.test.ts](../../../tests/legacy-contact-profile.test.ts)
- [legacy-contact-records.test.ts](../../../tests/legacy-contact-records.test.ts)
- [legacy-contact-write.test.ts](../../../tests/legacy-contact-write.test.ts)
- [legacy-contacts.test.ts](../../../tests/legacy-contacts.test.ts)
- [legacy-conversations.test.ts](../../../tests/legacy-conversations.test.ts)
- [legacy-label-management.test.ts](../../../tests/legacy-label-management.test.ts)
- [legacy-messaging.test.ts](../../../tests/legacy-messaging.test.ts)
- [legacy-mobile.test.ts](../../../tests/legacy-mobile.test.ts)
- [legacy-search.test.ts](../../../tests/legacy-search.test.ts)
- [legacy-store-history.test.ts](../../../tests/legacy-store-history.test.ts)
- [legacy-translations.test.ts](../../../tests/legacy-translations.test.ts)
- [legacy-whatsapp-orders.test.ts](../../../tests/legacy-whatsapp-orders.test.ts)
- [media-messaging.test.ts](../../../tests/media-messaging.test.ts)
- [message-window.test.ts](../../../tests/message-window.test.ts)
- [meta-flows.test.ts](../../../tests/meta-flows.test.ts)
- [quoted-replies.test.ts](../../../tests/quoted-replies.test.ts)
- [reactions.test.ts](../../../tests/reactions.test.ts)
- [security.test.ts](../../../tests/security.test.ts)
- [translations.test.ts](../../../tests/translations.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
