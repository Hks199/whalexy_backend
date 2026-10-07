# dashboard

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router          | Mounted prefix                        |
| --------------- | ------------------------------------- |
| dashboardRouter | `/api/v1/vendors/:vendorId/dashboard` |

## Files to read

### Routes

- [dashboard.routes.ts](dashboard.routes.ts)

### Controllers

- [dashboard.controller.ts](dashboard.controller.ts)

### Services and domain helpers

- [dashboard.service.ts](dashboard.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router          | Method | Relative path | Controller          |
| --------------- | ------ | ------------- | ------------------- |
| dashboardRouter | GET    | `/`           | getDashboardSummary |

## Behavior tests

- [ads-manager.test.ts](../../../tests/ads-manager.test.ts)
- [legacy-ads.test.ts](../../../tests/legacy-ads.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
