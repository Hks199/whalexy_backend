# bot-replies

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                 | Mounted prefix                          |
| ---------------------- | --------------------------------------- |
| legacyBotRepliesRouter | `/vendor-console/bot-replies`           |
| botRepliesRouter       | `/api/v1/vendors/:vendorId/bot-replies` |

## Files to read

### Routes

- [bot-replies.routes.ts](bot-replies.routes.ts)
- [legacy-bot-replies.routes.ts](legacy-bot-replies.routes.ts)

### Controllers

- [bot-replies.controller.ts](bot-replies.controller.ts)
- [legacy-bot-replies.controller.ts](legacy-bot-replies.controller.ts)

### Validation

- [bot-replies.validation.ts](bot-replies.validation.ts)
- [legacy-bot-replies.validation.ts](legacy-bot-replies.validation.ts)

### Middleware

- [bot-replies.middleware.ts](bot-replies.middleware.ts)

### Services and domain helpers

- [services/bot-replies-support.service.ts](services/bot-replies-support.service.ts)
- [services/legacy-bot-replies.service.ts](services/legacy-bot-replies.service.ts)
- [services/reply-access.service.ts](services/reply-access.service.ts)
- [services/reply-management.service.ts](services/reply-management.service.ts)
- [services/reply-runtime.service.ts](services/reply-runtime.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                 | Method | Relative path                         | Controller      |
| ---------------------- | ------ | ------------------------------------- | --------------- |
| botRepliesRouter       | GET    | `/`                                   | listBotReplies  |
| botRepliesRouter       | POST   | `/`                                   | createBotReply  |
| botRepliesRouter       | PUT    | `/:id`                                | updateBotReply  |
| botRepliesRouter       | DELETE | `/:id`                                | deleteBotReply  |
| botRepliesRouter       | PUT    | `/settings/timing`                    | updateBotTiming |
| legacyBotRepliesRouter | GET    | `/list-data`                          | list            |
| legacyBotRepliesRouter | GET    | `/:botReplyIdOrUid/get-update-data`   | edit            |
| legacyBotRepliesRouter | POST   | `/add-process`                        | create          |
| legacyBotRepliesRouter | POST   | `/update-process`                     | update          |
| legacyBotRepliesRouter | POST   | `/:botReplyIdOrUid/duplicate-process` | duplicate       |
| legacyBotRepliesRouter | POST   | `/:botReplyIdOrUid/delete-process`    | remove          |

## Behavior tests

- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [legacy-bot-flows.test.ts](../../../tests/legacy-bot-flows.test.ts)
- [legacy-bot-replies.test.ts](../../../tests/legacy-bot-replies.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
