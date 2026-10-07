# out-of-office

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                  | Mounted prefix                            |
| ----------------------- | ----------------------------------------- |
| legacyOutOfOfficeRouter | `/vendor-console/settings/out-of-office`  |
| outOfOfficeRouter       | `/api/v1/vendors/:vendorId/out-of-office` |

## Files to read

### Routes

- [legacy-out-of-office.routes.ts](legacy-out-of-office.routes.ts)
- [out-of-office.routes.ts](out-of-office.routes.ts)

### Controllers

- [legacy-out-of-office.controller.ts](legacy-out-of-office.controller.ts)
- [out-of-office.controller.ts](out-of-office.controller.ts)

### Validation

- [legacy-out-of-office.validation.ts](legacy-out-of-office.validation.ts)
- [out-of-office.validation.ts](out-of-office.validation.ts)

### Services and domain helpers

- [out-of-office.service.ts](out-of-office.service.ts)
- [services/legacy-out-of-office.service.ts](services/legacy-out-of-office.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                  | Method | Relative path | Controller         |
| ----------------------- | ------ | ------------- | ------------------ |
| legacyOutOfOfficeRouter | GET    | `/`           | read               |
| legacyOutOfOfficeRouter | POST   | `/`           | write              |
| outOfOfficeRouter       | GET    | `/`           | getAwaySettings    |
| outOfOfficeRouter       | POST   | `/`           | updateAwaySettings |

## Behavior tests

- [legacy-out-of-office.test.ts](../../../tests/legacy-out-of-office.test.ts)
- [out-of-office.test.ts](../../../tests/out-of-office.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
