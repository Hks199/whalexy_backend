# store-orders

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                   | Mounted prefix                |
| ------------------------ | ----------------------------- |
| legacyStoreHistoryRouter | `/vendor-console/integration` |

## Files to read

### Routes

- [legacy-store-history.routes.ts](legacy-store-history.routes.ts)

### Controllers

- [legacy-store-history.controller.ts](legacy-store-history.controller.ts)

### Validation

- [legacy-store-history.validation.ts](legacy-store-history.validation.ts)

### Services and domain helpers

- [services/legacy-store-history.service.ts](services/legacy-store-history.service.ts)
- [services/store-history-projection.service.ts](services/store-history-projection.service.ts)
- [store-orders.service.ts](store-orders.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                   | Method | Relative path                  | Controller           |
| ------------------------ | ------ | ------------------------------ | -------------------- |
| legacyStoreHistoryRouter | GET    | `/shopify/orders`              | shopifyOrders        |
| legacyStoreHistoryRouter | GET    | `/woocommerce/orders`          | wooOrders            |
| legacyStoreHistoryRouter | GET    | `/shopify/orders/:orderId`     | shopifyDetails       |
| legacyStoreHistoryRouter | GET    | `/woocommerce/orders/:orderId` | wooDetails           |
| legacyStoreHistoryRouter | GET    | `/shopify/notifications`       | shopifyNotifications |
| legacyStoreHistoryRouter | GET    | `/woocommerce/notifications`   | wooNotifications     |

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
