# cx-scores

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router               | Mounted prefix                        |
| -------------------- | ------------------------------------- |
| legacyCxScoresRouter | `/vendor-console/cx-analytics`        |
| cxScoresRouter       | `/api/v1/vendors/:vendorId/cx-scores` |

## Files to read

### Routes

- [cx-scores.routes.ts](cx-scores.routes.ts)
- [legacy-cx-scores.routes.ts](legacy-cx-scores.routes.ts)

### Controllers

- [cx-scores.controller.ts](cx-scores.controller.ts)
- [legacy-cx-scores.controller.ts](legacy-cx-scores.controller.ts)

### Validation

- [cx-scores.validation.ts](cx-scores.validation.ts)
- [legacy-cx-scores.validation.ts](legacy-cx-scores.validation.ts)

### Services and domain helpers

- [cx-scores.service.ts](cx-scores.service.ts)
- [services/legacy-cx-scores.service.ts](services/legacy-cx-scores.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router               | Method | Relative path                    | Controller                   |
| -------------------- | ------ | -------------------------------- | ---------------------------- |
| cxScoresRouter       | GET    | `/`                              | listCustomerExperienceScores |
| cxScoresRouter       | GET    | `/:id`                           | getCustomerExperienceScore   |
| cxScoresRouter       | POST   | `/:id/retry`                     | retryCustomerExperienceScore |
| legacyCxScoresRouter | GET    | `/conversations/:conversationId` | show                         |
| legacyCxScoresRouter | POST   | `/scores/:scoreId/retry`         | retry                        |

## Behavior tests

- [legacy-classifications-cx.test.ts](../../../tests/legacy-classifications-cx.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
