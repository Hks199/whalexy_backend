# comment-automations

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                   | Mounted prefix                                  |
| ------------------------ | ----------------------------------------------- |
| commentAutomationsRouter | `/api/v1/vendors/:vendorId/comment-automations` |

## Files to read

### Routes

- [comment-automations.routes.ts](comment-automations.routes.ts)

### Controllers

- [comment-automations.controller.ts](comment-automations.controller.ts)

### Validation

- [comment-automations.validation.ts](comment-automations.validation.ts)

### Middleware

- [comment-automations.middleware.ts](comment-automations.middleware.ts)

### Services and domain helpers

- [services/automation-management.service.ts](services/automation-management.service.ts)
- [services/automation-recovery.service.ts](services/automation-recovery.service.ts)
- [services/comment-automations-support.service.ts](services/comment-automations-support.service.ts)
- [services/comment-delivery.service.ts](services/comment-delivery.service.ts)
- [services/comment-events.ts](services/comment-events.ts)
- [services/comment-ingestion.service.ts](services/comment-ingestion.service.ts)
- [services/follow-checks.service.ts](services/follow-checks.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                   | Method | Relative path | Controller               |
| ------------------------ | ------ | ------------- | ------------------------ |
| commentAutomationsRouter | GET    | `/`           | listCommentAutomations   |
| commentAutomationsRouter | GET    | `/executions` | listAutomationExecutions |
| commentAutomationsRouter | POST   | `/`           | createCommentAutomation  |
| commentAutomationsRouter | GET    | `/:id`        | getCommentAutomation     |
| commentAutomationsRouter | PUT    | `/:id`        | updateCommentAutomation  |
| commentAutomationsRouter | DELETE | `/:id`        | deleteCommentAutomation  |

## Behavior tests

- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
