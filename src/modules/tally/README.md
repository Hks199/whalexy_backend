# tally

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router            | Mounted prefix                    |
| ----------------- | --------------------------------- |
| legacyTallyRouter | `/api/:vendorUid/tally`           |
| tallyRouter       | `/api/v1/vendors/:vendorId/tally` |

## Files to read

### Routes

- [legacy-tally.routes.ts](legacy-tally.routes.ts)
- [tally.routes.ts](tally.routes.ts)

### Controllers

- [legacy-tally.controller.ts](legacy-tally.controller.ts)
- [tally.controller.ts](tally.controller.ts)

### Validation

- [legacy-tally.validation.ts](legacy-tally.validation.ts)
- [tally.validation.ts](tally.validation.ts)

### Services and domain helpers

- [services/legacy-tally.service.ts](services/legacy-tally.service.ts)
- [tally.service.ts](tally.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router            | Method | Relative path         | Controller             |
| ----------------- | ------ | --------------------- | ---------------------- |
| legacyTallyRouter | GET    | `/ping`               | pingLegacyTally        |
| legacyTallyRouter | POST   | `/send-invoice`       | sendLegacyTallyInvoice |
| tallyRouter       | GET    | `/ping`               | checkTallyConnection   |
| tallyRouter       | POST   | `/invoices`           | ingestTallyInvoice     |
| tallyRouter       | GET    | `/invoices/:sourceId` | getTallyInvoiceStatus  |

## Behavior tests

- [tally.test.ts](../../../tests/tally.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
