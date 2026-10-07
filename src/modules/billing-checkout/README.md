# billing-checkout

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router         | Mounted prefix                      |
| -------------- | ----------------------------------- |
| checkoutRouter | `/api/v1/vendors/:vendorId/billing` |

## Files to read

### Routes

- [billing-checkout.routes.ts](billing-checkout.routes.ts)

### Controllers

- [billing-checkout.controller.ts](billing-checkout.controller.ts)

### Validation

- [billing-checkout.validation.ts](billing-checkout.validation.ts)

### Services and domain helpers

- [billing-checkout.service.ts](billing-checkout.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router         | Method | Relative path | Controller                 |
| -------------- | ------ | ------------- | -------------------------- |
| checkoutRouter | GET    | `/plans`      | listBillingPlans           |
| checkoutRouter | POST   | `/checkout`   | createCheckoutSession      |
| checkoutRouter | POST   | `/portal`     | createBillingPortalSession |
| checkoutRouter | GET    | `/invoices`   | listBillingInvoices        |

## Behavior tests

- [billing-checkout.test.ts](../../../tests/billing-checkout.test.ts)
- [billing-invoices.test.ts](../../../tests/billing-invoices.test.ts)
- [billing.test.ts](../../../tests/billing.test.ts)
- [manual-billing.test.ts](../../../tests/manual-billing.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
