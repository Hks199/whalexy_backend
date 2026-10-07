# media

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router      | Mounted prefix                    |
| ----------- | --------------------------------- |
| mediaRouter | `/api/v1/vendors/:vendorId/media` |

## Files to read

### Routes

- [media.routes.ts](media.routes.ts)

### Controllers

- [media.controller.ts](media.controller.ts)

### Middleware

- [media.middleware.ts](media.middleware.ts)

### Services and domain helpers

- [media.service.ts](media.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router      | Method | Relative path | Controller    |
| ----------- | ------ | ------------- | ------------- |
| mediaRouter | POST   | `/`           | uploadMedia   |
| mediaRouter | GET    | `/:id`        | downloadMedia |

## Behavior tests

- [media-messaging.test.ts](../../../tests/media-messaging.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
