# meta-signup

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router           | Mounted prefix                           |
| ---------------- | ---------------------------------------- |
| metaSignupRouter | `/api/v1/vendors/:vendorId/integrations` |

## Files to read

### Routes

- [meta-signup.routes.ts](meta-signup.routes.ts)

### Controllers

- [meta-signup.controller.ts](meta-signup.controller.ts)

### Validation

- [meta-signup.validation.ts](meta-signup.validation.ts)

### Services and domain helpers

- [meta-signup.service.ts](meta-signup.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router           | Method | Relative path           | Controller         |
| ---------------- | ------ | ----------------------- | ------------------ |
| metaSignupRouter | POST   | `/meta/signup/start`    | startMetaSignup    |
| metaSignupRouter | POST   | `/meta/signup/complete` | completeMetaSignup |

## Behavior tests

- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [contact-workflows.test.ts](../../../tests/contact-workflows.test.ts)
- [integration-lifecycle.test.ts](../../../tests/integration-lifecycle.test.ts)
- [meta-signup.test.ts](../../../tests/meta-signup.test.ts)
- [store-notifications.test.ts](../../../tests/store-notifications.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
