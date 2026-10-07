# billing

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router             | Mounted prefix                            |
| ------------------ | ----------------------------------------- |
| adminBillingRouter | `/api/v1/admin/vendors/:vendorId/billing` |
| billingRouter      | `/api/v1/vendors/:vendorId/billing`       |

## Files to read

### Routes

- [billing.routes.ts](billing.routes.ts)

### Controllers

- [billing.controller.ts](billing.controller.ts)

### Validation

- [billing.validation.ts](billing.validation.ts)

### Middleware

- [billing.middleware.ts](billing.middleware.ts)

### Services and domain helpers

- [services/billing-administration.service.ts](services/billing-administration.service.ts)
- [services/billing-summary.service.ts](services/billing-summary.service.ts)
- [services/billing-support.service.ts](services/billing-support.service.ts)
- [services/stripe-subscriptions.service.ts](services/stripe-subscriptions.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router             | Method | Relative path                 | Controller               |
| ------------------ | ------ | ----------------------------- | ------------------------ |
| adminBillingRouter | POST   | `/manual/:id/${action}`       | reviewManualSubscription |
| adminBillingRouter | GET    | `/manual/:id/receipt`         | downloadPaymentReceipt   |
| adminBillingRouter | POST   | `/addons/ai-replies/override` | overrideAiReplyAllowance |
| adminBillingRouter | DELETE | `/addons/ai-replies/override` | removeAiReplyOverride    |
| billingRouter      | GET    | `/`                           | getBillingSummary        |

## Behavior tests

- [billing-checkout.test.ts](../../../tests/billing-checkout.test.ts)
- [billing-invoices.test.ts](../../../tests/billing-invoices.test.ts)
- [billing.test.ts](../../../tests/billing.test.ts)
- [manual-billing.test.ts](../../../tests/manual-billing.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
