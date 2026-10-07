# guide

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router      | Mounted prefix                    |
| ----------- | --------------------------------- |
| guideRouter | `/api/v1/vendors/:vendorId/guide` |

## Files to read

### Routes

- [guide.routes.ts](guide.routes.ts)

### Controllers

- [guide.controller.ts](guide.controller.ts)

### Services and domain helpers

- [guide.service.ts](guide.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router      | Method | Relative path | Controller        |
| ----------- | ------ | ------------- | ----------------- |
| guideRouter | GET    | `/`           | getWorkspaceGuide |

## Behavior tests

- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [guide.test.ts](../../../tests/guide.test.ts)
- [site-settings.test.ts](../../../tests/site-settings.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
