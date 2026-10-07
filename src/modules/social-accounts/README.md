# social-accounts

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router               | Mounted prefix                           |
| -------------------- | ---------------------------------------- |
| socialAccountsRouter | `/api/v1/vendors/:vendorId/integrations` |

## Files to read

### Routes

- [social-accounts.routes.ts](social-accounts.routes.ts)

### Controllers

- [social-accounts.controller.ts](social-accounts.controller.ts)

### Validation

- [social-accounts.validation.ts](social-accounts.validation.ts)

### Services and domain helpers

- [social-accounts.service.ts](social-accounts.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router               | Method | Relative path     | Controller           |
| -------------------- | ------ | ----------------- | -------------------- |
| socialAccountsRouter | POST   | `/social/connect` | connectSocialAccount |

## Behavior tests

- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [contact-workflows.test.ts](../../../tests/contact-workflows.test.ts)
- [integration-lifecycle.test.ts](../../../tests/integration-lifecycle.test.ts)
- [meta-signup.test.ts](../../../tests/meta-signup.test.ts)
- [store-notifications.test.ts](../../../tests/store-notifications.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
