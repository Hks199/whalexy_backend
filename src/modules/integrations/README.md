# integrations

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                   | Mounted prefix                           |
| ------------------------ | ---------------------------------------- |
| legacyStoreReportsRouter | `/vendor-console/integration`            |
| integrationsRouter       | `/api/v1/vendors/:vendorId/integrations` |

## Files to read

### Routes

- [integrations.routes.ts](integrations.routes.ts)
- [legacy-store-reports.routes.ts](legacy-store-reports.routes.ts)

### Controllers

- [integrations.controller.ts](integrations.controller.ts)
- [legacy-store-reports.controller.ts](legacy-store-reports.controller.ts)

### Validation

- [integrations.validation.ts](integrations.validation.ts)
- [legacy-store-reports.validation.ts](legacy-store-reports.validation.ts)

### Services and domain helpers

- [integrations.service.ts](integrations.service.ts)
- [services/legacy-store-reports.service.ts](services/legacy-store-reports.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                   | Method | Relative path             | Controller              |
| ------------------------ | ------ | ------------------------- | ----------------------- |
| integrationsRouter       | GET    | `/`                       | listIntegrations        |
| integrationsRouter       | POST   | `/meta`                   | connectMetaIntegration  |
| integrationsRouter       | DELETE | `/:id`                    | disconnectIntegration   |
| integrationsRouter       | POST   | `/store`                  | connectStoreIntegration |
| integrationsRouter       | POST   | `/templates/sync`         | syncMessageTemplates    |
| legacyStoreReportsRouter | GET    | `/shopify/status`         | shopifyStatus           |
| legacyStoreReportsRouter | GET    | `/woocommerce/status`     | woocommerceStatus       |
| legacyStoreReportsRouter | GET    | `/shopify/statistics`     | shopifyStatistics       |
| legacyStoreReportsRouter | GET    | `/woocommerce/statistics` | woocommerceStatistics   |

## Behavior tests

- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [contact-workflows.test.ts](../../../tests/contact-workflows.test.ts)
- [integration-lifecycle.test.ts](../../../tests/integration-lifecycle.test.ts)
- [legacy-store-history.test.ts](../../../tests/legacy-store-history.test.ts)
- [legacy-store-reports.test.ts](../../../tests/legacy-store-reports.test.ts)
- [legacy-store-retry.test.ts](../../../tests/legacy-store-retry.test.ts)
- [legacy-store-settings.test.ts](../../../tests/legacy-store-settings.test.ts)
- [meta-signup.test.ts](../../../tests/meta-signup.test.ts)
- [store-notifications.test.ts](../../../tests/store-notifications.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
