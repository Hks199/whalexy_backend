# flow-data

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                 | Mounted prefix                                        |
| ---------------------- | ----------------------------------------------------- |
| flowDataWebhookRouter  | `/webhooks/flows`                                     |
| flowDataSettingsRouter | `/api/v1/vendors/:vendorId/meta-flows/:phoneNumberId` |

## Files to read

### Routes

- [flow-data.routes.ts](flow-data.routes.ts)

### Controllers

- [flow-data.controller.ts](flow-data.controller.ts)

### Validation

- [flow-data.validation.ts](flow-data.validation.ts)

### Services and domain helpers

- [services/endpoint-definition.ts](services/endpoint-definition.ts)
- [services/flow-data-exchange.service.ts](services/flow-data-exchange.service.ts)
- [services/flow-data-support.service.ts](services/flow-data-support.service.ts)
- [services/flow-encryption-keys.service.ts](services/flow-encryption-keys.service.ts)
- [services/flow-endpoint-settings.service.ts](services/flow-endpoint-settings.service.ts)
- [services/flow-sessions.service.ts](services/flow-sessions.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                 | Method | Relative path            | Controller                 |
| ---------------------- | ------ | ------------------------ | -------------------------- |
| flowDataSettingsRouter | POST   | `/encryption-key`        | registerFlowEncryptionKey  |
| flowDataSettingsRouter | GET    | `/encryption-key`        | getFlowEncryptionKey       |
| flowDataSettingsRouter | PUT    | `/:flowId/data-endpoint` | configureFlowDataEndpoint  |
| flowDataSettingsRouter | GET    | `/:flowId/data-endpoint` | getFlowDataEndpoint        |
| flowDataWebhookRouter  | POST   | `/:credentialId`         | handleEncryptedFlowRequest |

## Behavior tests

- [bot-meta-flows.test.ts](../../../tests/bot-meta-flows.test.ts)
- [flow-data.test.ts](../../../tests/flow-data.test.ts)
- [meta-flows.test.ts](../../../tests/meta-flows.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
