# sheets

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router       | Mounted prefix                     |
| ------------ | ---------------------------------- |
| sheetsRouter | `/api/v1/vendors/:vendorId/sheets` |

## Files to read

### Routes

- [sheets.routes.ts](sheets.routes.ts)

### Controllers

- [sheets.controller.ts](sheets.controller.ts)

### Validation

- [sheets.validation.ts](sheets.validation.ts)

### Services and domain helpers

- [services/sheet-ingestion.service.ts](services/sheet-ingestion.service.ts)
- [services/sheet-integrations.service.ts](services/sheet-integrations.service.ts)
- [services/sheet-script.ts](services/sheet-script.ts)
- [services/sheets-support.service.ts](services/sheets-support.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router       | Method | Relative path  | Controller             |
| ------------ | ------ | -------------- | ---------------------- |
| sheetsRouter | GET    | `/`            | listSheetIntegrations  |
| sheetsRouter | GET    | `/templates`   | listSheetTemplates     |
| sheetsRouter | POST   | `/`            | createSheetIntegration |
| sheetsRouter | GET    | `/:uid`        | getSheetIntegration    |
| sheetsRouter | GET    | `/:uid/script` | getSheetScript         |
| sheetsRouter | PATCH  | `/:uid/status` | updateSheetStatus      |
| sheetsRouter | DELETE | `/:uid`        | deleteSheetIntegration |
| sheetsRouter | POST   | `/:uid/rows`   | ingestSheetRows        |

## Behavior tests

- [sheets.test.ts](../../../tests/sheets.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
