# contacts

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                        | Mounted prefix                       |
| ----------------------------- | ------------------------------------ |
| legacyConversationRouter      | `/vendor-console/conversations`      |
| legacyContactAutomationRouter | `/vendor-console/contacts`           |
| legacyContactListRouter       | `/api/vendor/contact`                |
| legacyContactRouter           | `/api/:vendorUid/contact`            |
| contactsRouter                | `/api/v1/vendors/:vendorId/contacts` |

## Files to read

### Routes

- [contacts.routes.ts](contacts.routes.ts)
- [legacy-contact-automation.routes.ts](legacy-contact-automation.routes.ts)
- [legacy-contact-list.routes.ts](legacy-contact-list.routes.ts)
- [legacy-contact.routes.ts](legacy-contact.routes.ts)
- [legacy-conversation.routes.ts](legacy-conversation.routes.ts)

### Controllers

- [contacts.controller.ts](contacts.controller.ts)
- [legacy-contact-automation.controller.ts](legacy-contact-automation.controller.ts)
- [legacy-contact-list.controller.ts](legacy-contact-list.controller.ts)
- [legacy-contact.controller.ts](legacy-contact.controller.ts)
- [legacy-conversation.controller.ts](legacy-conversation.controller.ts)

### Validation

- [contacts.validation.ts](contacts.validation.ts)
- [legacy-contact-automation.validation.ts](legacy-contact-automation.validation.ts)
- [legacy-contact-list.validation.ts](legacy-contact-list.validation.ts)
- [legacy-contact.validation.ts](legacy-contact.validation.ts)
- [legacy-conversation.validation.ts](legacy-conversation.validation.ts)

### Middleware

- [contacts.middleware.ts](contacts.middleware.ts)

### Services and domain helpers

- [contacts.service.ts](contacts.service.ts)
- [services/contact-automation.service.ts](services/contact-automation.service.ts)
- [services/contact-csv.ts](services/contact-csv.ts)
- [services/contact-values.ts](services/contact-values.ts)
- [services/conversation-resolution.ts](services/conversation-resolution.ts)
- [services/legacy-contact-list.service.ts](services/legacy-contact-list.service.ts)
- [services/legacy-contact.service.ts](services/legacy-contact.service.ts)
- [services/legacy-conversation.service.ts](services/legacy-conversation.service.ts)
- [services/legacy-resolution.service.ts](services/legacy-resolution.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                        | Method | Relative path                     | Controller                    |
| ----------------------------- | ------ | --------------------------------- | ----------------------------- |
| contactsRouter                | GET    | `/`                               | listContacts                  |
| contactsRouter                | POST   | `/`                               | createContact                 |
| contactsRouter                | GET    | `/:id`                            | getContact                    |
| contactsRouter                | PATCH  | `/:id`                            | updateContact                 |
| contactsRouter                | POST   | `/:id/assign`                     | assignContact                 |
| contactsRouter                | POST   | `/:id/resolve`                    | resolveContactConversation    |
| contactsRouter                | POST   | `/:id/ai`                         | updateContactAiSettings       |
| contactsRouter                | POST   | `/:id/marketing-consent`          | updateContactMarketingConsent |
| contactsRouter                | GET    | `/:id/messages`                   | listContactMessages           |
| contactsRouter                | POST   | `/:id/groups`                     | addContactToGroups            |
| legacyContactAutomationRouter | POST   | `/:contactIdOrUid/toggle-ai-bot`  | toggle                        |
| legacyContactListRouter       | GET    | `/contacts-data`                  | listLegacyContactsData        |
| legacyContactListRouter       | GET    | `/contacts-data/:contactUid`      | listLegacyContactsData        |
| legacyContactRouter           | POST   | `/create`                         | createLegacyContact           |
| legacyContactRouter           | POST   | `/update/:phoneNumber`            | updateLegacyContact           |
| legacyConversationRouter      | POST   | `/:conversationId/resolve`        | resolve                       |
| legacyConversationRouter      | POST   | `/:conversationId/reopen`         | reopen                        |
| legacyConversationRouter      | POST   | `/:conversationId/handoff/accept` | accept                        |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [campaign-workflows.test.ts](../../../tests/campaign-workflows.test.ts)
- [classifications-cx.test.ts](../../../tests/classifications-cx.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [contact-data.test.ts](../../../tests/contact-data.test.ts)
- [contact-fields.test.ts](../../../tests/contact-fields.test.ts)
- [contact-lifecycle.test.ts](../../../tests/contact-lifecycle.test.ts)
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
- [legacy-resolution.test.ts](../../../tests/legacy-resolution.test.ts)
- [legacy-store-history.test.ts](../../../tests/legacy-store-history.test.ts)
- [quoted-replies.test.ts](../../../tests/quoted-replies.test.ts)
- [security.test.ts](../../../tests/security.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
