# dashboard

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                    | Mounted prefix                        |
| ------------------------- | ------------------------------------- |
| legacyCentralSearchRouter | `/central-console`                    |
| legacyVendorSearchRouter  | `/vendor-console`                     |
| dashboardRouter           | `/api/v1/vendors/:vendorId/dashboard` |

## Files to read

### Routes

- [dashboard.routes.ts](dashboard.routes.ts)
- [legacy-search.routes.ts](legacy-search.routes.ts)

### Controllers

- [dashboard.controller.ts](dashboard.controller.ts)
- [legacy-search.controller.ts](legacy-search.controller.ts)

### Validation

- [legacy-search.validation.ts](legacy-search.validation.ts)

### Services and domain helpers

- [dashboard.service.ts](dashboard.service.ts)
- [services/legacy-search.service.ts](services/legacy-search.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                    | Method | Relative path    | Controller          |
| ------------------------- | ------ | ---------------- | ------------------- |
| dashboardRouter           | GET    | `/`              | getDashboardSummary |
| legacyVendorSearchRouter  | GET    | `/global-search` | vendor              |
| legacyCentralSearchRouter | GET    | `/global-search` | central             |

## Behavior tests

- [ads-manager.test.ts](../../../tests/ads-manager.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [legacy-ads.test.ts](../../../tests/legacy-ads.test.ts)
- [legacy-blogs.test.ts](../../../tests/legacy-blogs.test.ts)
- [legacy-bot-flows.test.ts](../../../tests/legacy-bot-flows.test.ts)
- [legacy-bot-replies.test.ts](../../../tests/legacy-bot-replies.test.ts)
- [legacy-campaign.test.ts](../../../tests/legacy-campaign.test.ts)
- [legacy-chat-message.test.ts](../../../tests/legacy-chat-message.test.ts)
- [legacy-chat-read.test.ts](../../../tests/legacy-chat-read.test.ts)
- [legacy-classifications-cx.test.ts](../../../tests/legacy-classifications-cx.test.ts)
- [legacy-configuration.test.ts](../../../tests/legacy-configuration.test.ts)
- [legacy-contact-assignment.test.ts](../../../tests/legacy-contact-assignment.test.ts)
- [legacy-contact-bulk-delete.test.ts](../../../tests/legacy-contact-bulk-delete.test.ts)
- [legacy-contact-directory.test.ts](../../../tests/legacy-contact-directory.test.ts)
- [legacy-contact-fields.test.ts](../../../tests/legacy-contact-fields.test.ts)
- [legacy-contact-groups.test.ts](../../../tests/legacy-contact-groups.test.ts)
- [legacy-contact-memberships.test.ts](../../../tests/legacy-contact-memberships.test.ts)
- [legacy-contact-profile.test.ts](../../../tests/legacy-contact-profile.test.ts)
- [legacy-contact-records.test.ts](../../../tests/legacy-contact-records.test.ts)
- [legacy-contact-write.test.ts](../../../tests/legacy-contact-write.test.ts)
- [legacy-conversations.test.ts](../../../tests/legacy-conversations.test.ts)
- [legacy-label-management.test.ts](../../../tests/legacy-label-management.test.ts)
- [legacy-out-of-office.test.ts](../../../tests/legacy-out-of-office.test.ts)
- [legacy-pages.test.ts](../../../tests/legacy-pages.test.ts)
- [legacy-resolution.test.ts](../../../tests/legacy-resolution.test.ts)
- [legacy-search.test.ts](../../../tests/legacy-search.test.ts)
- [legacy-store-history.test.ts](../../../tests/legacy-store-history.test.ts)
- [legacy-store-reports.test.ts](../../../tests/legacy-store-reports.test.ts)
- [legacy-store-retry.test.ts](../../../tests/legacy-store-retry.test.ts)
- [legacy-store-settings.test.ts](../../../tests/legacy-store-settings.test.ts)
- [legacy-translations.test.ts](../../../tests/legacy-translations.test.ts)
- [legacy-whatsapp-orders.test.ts](../../../tests/legacy-whatsapp-orders.test.ts)
- [quoted-replies.test.ts](../../../tests/quoted-replies.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
