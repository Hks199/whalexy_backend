# store-notifications

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                    | Mounted prefix                           |
| ------------------------- | ---------------------------------------- |
| legacyStoreRetryRouter    | `/vendor-console/integration`            |
| legacyStoreSettingsRouter | `/vendor-console/integration`            |
| storeNotificationsRouter  | `/api/v1/vendors/:vendorId/integrations` |

## Files to read

### Routes

- [legacy-store-retry.routes.ts](legacy-store-retry.routes.ts)
- [legacy-store-settings.routes.ts](legacy-store-settings.routes.ts)
- [store-notifications.routes.ts](store-notifications.routes.ts)

### Controllers

- [legacy-store-retry.controller.ts](legacy-store-retry.controller.ts)
- [legacy-store-settings.controller.ts](legacy-store-settings.controller.ts)
- [store-notifications.controller.ts](store-notifications.controller.ts)

### Validation

- [legacy-store-retry.validation.ts](legacy-store-retry.validation.ts)
- [legacy-store-settings.validation.ts](legacy-store-settings.validation.ts)
- [store-notifications.validation.ts](store-notifications.validation.ts)

### Services and domain helpers

- [services/legacy-store-retry.service.ts](services/legacy-store-retry.service.ts)
- [services/legacy-store-settings.service.ts](services/legacy-store-settings.service.ts)
- [services/notification-delivery.service.ts](services/notification-delivery.service.ts)
- [services/notification-settings.service.ts](services/notification-settings.service.ts)
- [services/store-notifications-support.service.ts](services/store-notifications-support.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                    | Method | Relative path                                       | Controller                      |
| ------------------------- | ------ | --------------------------------------------------- | ------------------------------- |
| legacyStoreRetryRouter    | POST   | `/shopify/notifications/:notificationId/resend`     | shopify                         |
| legacyStoreRetryRouter    | POST   | `/woocommerce/notifications/:notificationId/resend` | woocommerce                     |
| legacyStoreSettingsRouter | POST   | `/shopify/update-notification-settings`             | shopify                         |
| legacyStoreSettingsRouter | POST   | `/woocommerce/update-notification-settings`         | woocommerce                     |
| storeNotificationsRouter  | GET    | `/stores/:provider/:integrationId/notifications`    | getStoreNotificationSettings    |
| storeNotificationsRouter  | PUT    | `/stores/:provider/:integrationId/notifications`    | updateStoreNotificationSettings |

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
