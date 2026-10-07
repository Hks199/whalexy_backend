# bot-flows

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router               | Mounted prefix                          |
| -------------------- | --------------------------------------- |
| legacyBotFlowsRouter | `/vendor-console/bot-replies/bot-flows` |
| botFlowsRouter       | `/api/v1/vendors/:vendorId/bot-flows`   |

## Files to read

### Routes

- [bot-flows.routes.ts](bot-flows.routes.ts)
- [legacy-bot-flows.routes.ts](legacy-bot-flows.routes.ts)

### Controllers

- [bot-flows.controller.ts](bot-flows.controller.ts)
- [legacy-bot-flows.controller.ts](legacy-bot-flows.controller.ts)

### Validation

- [bot-flows.validation.ts](bot-flows.validation.ts)
- [legacy-bot-flows.validation.ts](legacy-bot-flows.validation.ts)
- [services/graph-schema.validation.ts](services/graph-schema.validation.ts)

### Middleware

- [bot-flows.middleware.ts](bot-flows.middleware.ts)

### Types and constants

- [services/graph-types.types.ts](services/graph-types.types.ts)

### Services and domain helpers

- [bot-flows.service.ts](bot-flows.service.ts)
- [services/bot-catalog.ts](services/bot-catalog.ts)
- [services/bot-graph-runtime.ts](services/bot-graph-runtime.ts)
- [services/bot-meta-flow.ts](services/bot-meta-flow.ts)
- [services/bot-question.ts](services/bot-question.ts)
- [services/bot-template.ts](services/bot-template.ts)
- [services/bot-timing.ts](services/bot-timing.ts)
- [services/flow-access.service.ts](services/flow-access.service.ts)
- [services/graph-execution.service.ts](services/graph-execution.service.ts)
- [services/legacy-bot-flows.service.ts](services/legacy-bot-flows.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router               | Method | Relative path                      | Controller     |
| -------------------- | ------ | ---------------------------------- | -------------- |
| botFlowsRouter       | GET    | `/`                                | listBotFlows   |
| botFlowsRouter       | POST   | `path`                             | createBotFlow  |
| botFlowsRouter       | GET    | `/:id`                             | getBotFlow     |
| botFlowsRouter       | PUT    | `/:id`                             | updateBotFlow  |
| botFlowsRouter       | GET    | `/:id/export`                      | exportBotFlow  |
| botFlowsRouter       | POST   | `/:id/clone`                       | cloneBotFlow   |
| botFlowsRouter       | POST   | `/:id/preview`                     | previewBotFlow |
| botFlowsRouter       | DELETE | `/:id`                             | deleteBotFlow  |
| legacyBotFlowsRouter | GET    | `/list-data`                       | list           |
| legacyBotFlowsRouter | GET    | `/:botFlowIdOrUid/get-update-data` | edit           |
| legacyBotFlowsRouter | GET    | `/:botFlowIdOrUid/export`          | exportFlow     |
| legacyBotFlowsRouter | POST   | `/:botFlowIdOrUid/clone-process`   | clone          |
| legacyBotFlowsRouter | POST   | `/:botFlowIdOrUid/delete-process`  | remove         |
| legacyBotFlowsRouter | POST   | `/update-process`                  | update         |

## Behavior tests

- [advanced-interactive.test.ts](../../../tests/advanced-interactive.test.ts)
- [bot-catalogs.test.ts](../../../tests/bot-catalogs.test.ts)
- [bot-flows.test.ts](../../../tests/bot-flows.test.ts)
- [bot-meta-flows.test.ts](../../../tests/bot-meta-flows.test.ts)
- [bot-questions.test.ts](../../../tests/bot-questions.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [bot-templates.test.ts](../../../tests/bot-templates.test.ts)
- [interactive-messaging.test.ts](../../../tests/interactive-messaging.test.ts)
- [legacy-bot-flows.test.ts](../../../tests/legacy-bot-flows.test.ts)
- [media-messaging.test.ts](../../../tests/media-messaging.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
