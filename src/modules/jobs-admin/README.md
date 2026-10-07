# jobs-admin

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router     | Mounted prefix                   |
| ---------- | -------------------------------- |
| jobsRouter | `/api/v1/admin/jobs`             |
| jobsRouter | `/api/v1/vendors/:vendorId/jobs` |

## Files to read

### Routes

- [jobs-admin.routes.ts](jobs-admin.routes.ts)

### Controllers

- [jobs-admin.controller.ts](jobs-admin.controller.ts)

### Validation

- [jobs-admin.validation.ts](jobs-admin.validation.ts)

### Middleware

- [jobs-admin.middleware.ts](jobs-admin.middleware.ts)

### Services and domain helpers

- [jobs-admin.service.ts](jobs-admin.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router | Method | Relative path | Controller |
| ------ | ------ | ------------- | ---------- |
| router | GET    | `/`           | listJobs   |
| router | POST   | `/:id/retry`  | retryJob   |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [advanced-interactive.test.ts](../../../tests/advanced-interactive.test.ts)
- [appointment-reminders.test.ts](../../../tests/appointment-reminders.test.ts)
- [billing-checkout.test.ts](../../../tests/billing-checkout.test.ts)
- [billing.test.ts](../../../tests/billing.test.ts)
- [bot-catalogs.test.ts](../../../tests/bot-catalogs.test.ts)
- [bot-flows.test.ts](../../../tests/bot-flows.test.ts)
- [bot-meta-flows.test.ts](../../../tests/bot-meta-flows.test.ts)
- [bot-questions.test.ts](../../../tests/bot-questions.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [bot-templates.test.ts](../../../tests/bot-templates.test.ts)
- [campaign-workflows.test.ts](../../../tests/campaign-workflows.test.ts)
- [catalogs.test.ts](../../../tests/catalogs.test.ts)
- [classifications-cx.test.ts](../../../tests/classifications-cx.test.ts)
- [comment-automations.test.ts](../../../tests/comment-automations.test.ts)
- [contact-lifecycle.test.ts](../../../tests/contact-lifecycle.test.ts)
- [conversation-analysis.test.ts](../../../tests/conversation-analysis.test.ts)
- [flow-data.test.ts](../../../tests/flow-data.test.ts)
- [integration.test.ts](../../../tests/integration.test.ts)
- [interactive-messaging.test.ts](../../../tests/interactive-messaging.test.ts)
- [legacy-store-retry.test.ts](../../../tests/legacy-store-retry.test.ts)
- [media-messaging.test.ts](../../../tests/media-messaging.test.ts)
- [message-window.test.ts](../../../tests/message-window.test.ts)
- [meta-flows.test.ts](../../../tests/meta-flows.test.ts)
- [out-of-office.test.ts](../../../tests/out-of-office.test.ts)
- [quoted-replies.test.ts](../../../tests/quoted-replies.test.ts)
- [reactions.test.ts](../../../tests/reactions.test.ts)
- [sheets.test.ts](../../../tests/sheets.test.ts)
- [store-notifications.test.ts](../../../tests/store-notifications.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)
- [tally.test.ts](../../../tests/tally.test.ts)
- [verification-resend.test.ts](../../../tests/verification-resend.test.ts)
- [worker-reconciliation.test.ts](../../../tests/worker-reconciliation.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
