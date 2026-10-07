# resources

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router         | Mounted prefix                        |
| -------------- | ------------------------------------- |
| resourceRouter | `/api/v1/vendors/:vendorId/resources` |

## Files to read

### Routes

- [resources.routes.ts](resources.routes.ts)

### Controllers

- [resources.controller.ts](resources.controller.ts)

### Validation

- [resources.validation.ts](resources.validation.ts)

### Middleware

- [resources.middleware.ts](resources.middleware.ts)

### Services and domain helpers

- [resources.service.ts](resources.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router         | Method | Relative path    | Controller           |
| -------------- | ------ | ---------------- | -------------------- |
| resourceRouter | GET    | `/:resource`     | listResourceRecords  |
| resourceRouter | GET    | `/:resource/:id` | getResourceRecord    |
| resourceRouter | POST   | `/:resource`     | createResourceRecord |
| resourceRouter | PATCH  | `/:resource/:id` | updateResourceRecord |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [ads-manager.test.ts](../../../tests/ads-manager.test.ts)
- [appointment-management.test.ts](../../../tests/appointment-management.test.ts)
- [bot-flows.test.ts](../../../tests/bot-flows.test.ts)
- [classifications-cx.test.ts](../../../tests/classifications-cx.test.ts)
- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [contact-fields.test.ts](../../../tests/contact-fields.test.ts)
- [legacy-contact-groups.test.ts](../../../tests/legacy-contact-groups.test.ts)
- [legacy-label-management.test.ts](../../../tests/legacy-label-management.test.ts)
- [meta-flows.test.ts](../../../tests/meta-flows.test.ts)
- [sheets.test.ts](../../../tests/sheets.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
