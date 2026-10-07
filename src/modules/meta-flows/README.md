# meta-flows

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router          | Mounted prefix                                        |
| --------------- | ----------------------------------------------------- |
| metaFlowsRouter | `/api/v1/vendors/:vendorId/meta-flows/:phoneNumberId` |

## Files to read

### Routes

- [meta-flows.routes.ts](meta-flows.routes.ts)

### Controllers

- [meta-flows.controller.ts](meta-flows.controller.ts)

### Validation

- [meta-flows.validation.ts](meta-flows.validation.ts)

### Services and domain helpers

- [services/flow-definitions.service.ts](services/flow-definitions.service.ts)
- [services/flow-encryption.ts](services/flow-encryption.ts)
- [services/flow-management.service.ts](services/flow-management.service.ts)
- [services/meta-flow-message.ts](services/meta-flow-message.ts)
- [services/meta-flows-support.service.ts](services/meta-flows-support.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router          | Method | Relative path        | Controller               |
| --------------- | ------ | -------------------- | ------------------------ |
| metaFlowsRouter | GET    | `/`                  | listMetaFlows            |
| metaFlowsRouter | POST   | `/`                  | createMetaFlow           |
| metaFlowsRouter | GET    | `/:flowId`           | getMetaFlow              |
| metaFlowsRouter | PUT    | `/:flowId`           | updateMetaFlow           |
| metaFlowsRouter | PUT    | `/:flowId/json`      | updateMetaFlowDefinition |
| metaFlowsRouter | POST   | `/:flowId/${action}` | changeMetaFlowState      |
| metaFlowsRouter | GET    | `/:flowId/preview`   | previewMetaFlow          |
| metaFlowsRouter | GET    | `/:flowId/json`      | getMetaFlowDefinition    |

## Behavior tests

- [flow-data.test.ts](../../../tests/flow-data.test.ts)
- [meta-flows.test.ts](../../../tests/meta-flows.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
