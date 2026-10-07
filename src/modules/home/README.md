# home

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router     | Mounted prefix   |
| ---------- | ---------------- |
| homeRouter | `/api/v1/public` |

## Files to read

### Routes

- [home.routes.ts](home.routes.ts)

### Controllers

- [home.controller.ts](home.controller.ts)

### Validation

- [home.validation.ts](home.validation.ts)

### Types and constants

- [home.constants.ts](home.constants.ts)

### Services and domain helpers

- [home.service.ts](home.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router     | Method | Relative path       | Controller      |
| ---------- | ------ | ------------------- | --------------- |
| homeRouter | GET    | `/home`             | getPublicHome   |
| homeRouter | GET    | `/policies/:policy` | getPublicPolicy |

## Behavior tests

- [content.test.ts](../../../tests/content.test.ts)
- [knowledge.test.ts](../../../tests/knowledge.test.ts)
- [legacy-blogs.test.ts](../../../tests/legacy-blogs.test.ts)
- [legacy-pages.test.ts](../../../tests/legacy-pages.test.ts)
- [site-settings.test.ts](../../../tests/site-settings.test.ts)
- [translations.test.ts](../../../tests/translations.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
