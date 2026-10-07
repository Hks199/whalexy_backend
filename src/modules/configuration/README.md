# configuration

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                    | Mounted prefix                   |
| ------------------------- | -------------------------------- |
| legacyConfigurationRouter | `/central-console/configuration` |
| configurationRouter       | `/api/v1/admin/configuration`    |

## Files to read

### Routes

- [configuration.routes.ts](configuration.routes.ts)
- [legacy-configuration.routes.ts](legacy-configuration.routes.ts)

### Controllers

- [configuration.controller.ts](configuration.controller.ts)
- [legacy-configuration.controller.ts](legacy-configuration.controller.ts)

### Validation

- [configuration.validation.ts](configuration.validation.ts)
- [legacy-configuration.validation.ts](legacy-configuration.validation.ts)

### Middleware

- [configuration.middleware.ts](configuration.middleware.ts)

### Services and domain helpers

- [configuration.service.ts](configuration.service.ts)
- [services/configuration-access.service.ts](services/configuration-access.service.ts)
- [services/legacy-configuration.service.ts](services/legacy-configuration.service.ts)
- [services/site-settings.ts](services/site-settings.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                    | Method | Relative path                            | Controller         |
| ------------------------- | ------ | ---------------------------------------- | ------------------ |
| configurationRouter       | GET    | `/`                                      | listSettingGroups  |
| configurationRouter       | GET    | `/${group}`                              | getSettingGroup    |
| configurationRouter       | PATCH  | `/${group}`                              | updateSettingGroup |
| legacyConfigurationRouter | GET    | `/:pageType`                             | read               |
| legacyConfigurationRouter | POST   | `/:pageType/process-configuration-store` | write              |

## Behavior tests

- [legacy-configuration.test.ts](../../../tests/legacy-configuration.test.ts)
- [legacy-search.test.ts](../../../tests/legacy-search.test.ts)
- [site-settings.test.ts](../../../tests/site-settings.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
