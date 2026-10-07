# classifications

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                      | Mounted prefix                                 |
| --------------------------- | ---------------------------------------------- |
| legacyClassificationsRouter | `/vendor-console/whatsapp/chat/classification` |
| classificationsRouter       | `/api/v1/vendors/:vendorId/classifications`    |

## Files to read

### Routes

- [classifications.routes.ts](classifications.routes.ts)
- [legacy-classifications.routes.ts](legacy-classifications.routes.ts)

### Controllers

- [classifications.controller.ts](classifications.controller.ts)
- [legacy-classifications.controller.ts](legacy-classifications.controller.ts)

### Validation

- [classifications.validation.ts](classifications.validation.ts)
- [legacy-classifications.validation.ts](legacy-classifications.validation.ts)

### Services and domain helpers

- [classifications.service.ts](classifications.service.ts)
- [services/legacy-classifications.service.ts](services/legacy-classifications.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                      | Method | Relative path       | Controller                  |
| --------------------------- | ------ | ------------------- | --------------------------- |
| classificationsRouter       | GET    | `/presets`          | listClassificationPresets   |
| classificationsRouter       | GET    | `/contacts/:id`     | getContactClassification    |
| classificationsRouter       | PATCH  | `/contacts/:id`     | updateContactClassification |
| classificationsRouter       | POST   | `/tags`             | createClassificationTag     |
| classificationsRouter       | DELETE | `/tags/:id`         | deleteClassificationTag     |
| legacyClassificationsRouter | POST   | `/update`           | update                      |
| legacyClassificationsRouter | POST   | `/tag/create`       | createTag                   |
| legacyClassificationsRouter | GET    | `/logs/:contactUid` | logs                        |

## Behavior tests

- [classifications-cx.test.ts](../../../tests/classifications-cx.test.ts)
- [conversation-analysis.test.ts](../../../tests/conversation-analysis.test.ts)
- [legacy-classifications-cx.test.ts](../../../tests/legacy-classifications-cx.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
