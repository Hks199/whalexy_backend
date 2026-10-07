# webhooks

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router        | Mounted prefix |
| ------------- | -------------- |
| webhookRouter | `/webhooks`    |

## Files to read

### Routes

- [webhooks.routes.ts](webhooks.routes.ts)

### Controllers

- [webhooks.controller.ts](webhooks.controller.ts)

### Services and domain helpers

- [webhooks.service.ts](webhooks.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router        | Method | Relative path                     | Controller           |
| ------------- | ------ | --------------------------------- | -------------------- |
| webhookRouter | GET    | `/meta`                           | verifyMetaWebhook    |
| webhookRouter | POST   | `/meta`                           | handleMetaWebhook    |
| webhookRouter | POST   | `/stores/:provider/:credentialId` | handleStoreWebhook   |
| webhookRouter | POST   | `/payments/:provider`             | handlePaymentWebhook |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [billing-checkout.test.ts](../../../tests/billing-checkout.test.ts)
- [billing.test.ts](../../../tests/billing.test.ts)
- [bot-meta-flows.test.ts](../../../tests/bot-meta-flows.test.ts)
- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [flow-data.test.ts](../../../tests/flow-data.test.ts)
- [integration.test.ts](../../../tests/integration.test.ts)
- [security.test.ts](../../../tests/security.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
