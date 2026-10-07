# manual-billing

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router              | Mounted prefix                      |
| ------------------- | ----------------------------------- |
| manualBillingRouter | `/api/v1/vendors/:vendorId/billing` |

## Files to read

### Routes

- [manual-billing.routes.ts](manual-billing.routes.ts)

### Controllers

- [manual-billing.controller.ts](manual-billing.controller.ts)

### Validation

- [manual-billing.validation.ts](manual-billing.validation.ts)

### Middleware

- [manual-billing.middleware.ts](manual-billing.middleware.ts)

### Services and domain helpers

- [services/manual-billing-support.service.ts](services/manual-billing-support.service.ts)
- [services/manual-invoices.service.ts](services/manual-invoices.service.ts)
- [services/manual-subscriptions.service.ts](services/manual-subscriptions.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router              | Method | Relative path             | Controller              |
| ------------------- | ------ | ------------------------- | ----------------------- |
| manualBillingRouter | GET    | `/manual`                 | listManualSubscriptions |
| manualBillingRouter | POST   | `/manual/quote`           | quoteManualSubscription |
| manualBillingRouter | GET    | `/manual/:id`             | getManualSubscription   |
| manualBillingRouter | POST   | `/manual/:id/submit`      | submitManualPayment     |
| manualBillingRouter | POST   | `/manual/:id/cancel`      | cancelManualPayment     |
| manualBillingRouter | GET    | `/manual/:id/invoice`     | getManualInvoice        |
| manualBillingRouter | GET    | `/manual/:id/invoice.pdf` | downloadManualInvoice   |

## Behavior tests

- [billing-checkout.test.ts](../../../tests/billing-checkout.test.ts)
- [billing-invoices.test.ts](../../../tests/billing-invoices.test.ts)
- [billing.test.ts](../../../tests/billing.test.ts)
- [manual-billing.test.ts](../../../tests/manual-billing.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
