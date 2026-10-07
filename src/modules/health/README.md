# health

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router       | Mounted prefix |
| ------------ | -------------- |
| healthRouter | `/health`      |

## Files to read

### Routes

- [health.routes.ts](health.routes.ts)

### Controllers

- [health.controller.ts](health.controller.ts)

### Services and domain helpers

- [health.service.ts](health.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router       | Method | Relative path | Controller |
| ------------ | ------ | ------------- | ---------- |
| healthRouter | GET    | `/live`       | liveness   |
| healthRouter | GET    | `/ready`      | readiness  |

## Behavior tests

- [security.test.ts](../../../tests/security.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
