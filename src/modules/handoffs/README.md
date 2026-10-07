# handoffs

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router         | Mounted prefix                       |
| -------------- | ------------------------------------ |
| handoffsRouter | `/api/v1/vendors/:vendorId/handoffs` |

## Files to read

### Routes

- [handoffs.routes.ts](handoffs.routes.ts)

### Controllers

- [handoffs.controller.ts](handoffs.controller.ts)

### Validation

- [handoffs.validation.ts](handoffs.validation.ts)

### Middleware

- [handoffs.middleware.ts](handoffs.middleware.ts)

### Services and domain helpers

- [handoffs.service.ts](handoffs.service.ts)
- [services/accept-contact-handoff.service.ts](services/accept-contact-handoff.service.ts)
- [services/handoffs.ts](services/handoffs.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router         | Method | Relative path                 | Controller           |
| -------------- | ------ | ----------------------------- | -------------------- |
| handoffsRouter | POST   | `/contacts/:contactId/accept` | acceptContactHandoff |
| handoffsRouter | GET    | `/`                           | listHandoffs         |
| handoffsRouter | POST   | `/:id/transfer`               | transferHandoff      |
| handoffsRouter | POST   | `/:id/resolve`                | resolveHandoff       |

## Behavior tests

- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [legacy-conversations.test.ts](../../../tests/legacy-conversations.test.ts)
- [reactions.test.ts](../../../tests/reactions.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
