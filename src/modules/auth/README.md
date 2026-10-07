# auth

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router           | Mounted prefix |
| ---------------- | -------------- |
| legacyAuthRouter | `/api`         |
| authRouter       | `/api/v1/auth` |

## Files to read

### Routes

- [auth.routes.ts](auth.routes.ts)
- [legacy-auth.routes.ts](legacy-auth.routes.ts)

### Controllers

- [auth.controller.ts](auth.controller.ts)
- [legacy-auth.controller.ts](legacy-auth.controller.ts)

### Validation

- [auth.validation.ts](auth.validation.ts)
- [legacy-auth.validation.ts](legacy-auth.validation.ts)

### Services and domain helpers

- [auth.service.ts](auth.service.ts)
- [services/legacy-auth.service.ts](services/legacy-auth.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router           | Method | Relative path           | Controller                |
| ---------------- | ------ | ----------------------- | ------------------------- |
| authRouter       | POST   | `/register`             | register                  |
| authRouter       | POST   | `/resend-verification`  | resendVerification        |
| authRouter       | POST   | `/login`                | login                     |
| authRouter       | POST   | `/refresh`              | refreshSession            |
| authRouter       | POST   | `/logout`               | logout                    |
| authRouter       | GET    | `/me`                   | getCurrentUser            |
| authRouter       | POST   | `/verify-email`         | verifyEmail               |
| authRouter       | POST   | `/forgot-password`      | requestPasswordReset      |
| authRouter       | POST   | `/phone/start`          | startPhoneVerification    |
| authRouter       | POST   | `/phone/verify`         | verifyPhone               |
| authRouter       | POST   | `/reset-password`       | resetPassword             |
| legacyAuthRouter | POST   | `/user/login-process`   | loginLegacyUser           |
| legacyAuthRouter | GET    | `/user/prepare-sign-up` | prepareLegacyRegistration |
| legacyAuthRouter | POST   | `/user/process-sign-up` | registerLegacyUser        |
| legacyAuthRouter | POST   | `/user/logout`          | logoutLegacyUser          |
| legacyAuthRouter | GET    | `/user`                 | getLegacyCurrentUser      |
| legacyAuthRouter | GET    | `/`                     | getLegacyApiRoot          |
| legacyAuthRouter | POST   | `/`                     | getLegacyApiRoot          |
| legacyAuthRouter | PUT    | `/`                     | getLegacyApiRoot          |
| legacyAuthRouter | PATCH  | `/`                     | getLegacyApiRoot          |
| legacyAuthRouter | DELETE | `/`                     | getLegacyApiRoot          |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [ads-manager.test.ts](../../../tests/ads-manager.test.ts)
- [advanced-interactive.test.ts](../../../tests/advanced-interactive.test.ts)
- [appointment-management.test.ts](../../../tests/appointment-management.test.ts)
- [appointment-reminders.test.ts](../../../tests/appointment-reminders.test.ts)
- [appointment-workflows.test.ts](../../../tests/appointment-workflows.test.ts)
- [billing-checkout.test.ts](../../../tests/billing-checkout.test.ts)
- [billing-invoices.test.ts](../../../tests/billing-invoices.test.ts)
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
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [contact-data.test.ts](../../../tests/contact-data.test.ts)
- [contact-fields.test.ts](../../../tests/contact-fields.test.ts)
- [contact-lifecycle.test.ts](../../../tests/contact-lifecycle.test.ts)
- [contact-workflows.test.ts](../../../tests/contact-workflows.test.ts)
- [content.test.ts](../../../tests/content.test.ts)
- [conversation-analysis.test.ts](../../../tests/conversation-analysis.test.ts)
- [flow-data.test.ts](../../../tests/flow-data.test.ts)
- [guide.test.ts](../../../tests/guide.test.ts)
- [integration-lifecycle.test.ts](../../../tests/integration-lifecycle.test.ts)
- [integration.test.ts](../../../tests/integration.test.ts)
- [interactive-messaging.test.ts](../../../tests/interactive-messaging.test.ts)
- [knowledge.test.ts](../../../tests/knowledge.test.ts)
- [legacy-ads.test.ts](../../../tests/legacy-ads.test.ts)
- [legacy-appointment-bookings.test.ts](../../../tests/legacy-appointment-bookings.test.ts)
- [legacy-blogs.test.ts](../../../tests/legacy-blogs.test.ts)
- [legacy-bot-flows.test.ts](../../../tests/legacy-bot-flows.test.ts)
- [legacy-bot-replies.test.ts](../../../tests/legacy-bot-replies.test.ts)
- [legacy-campaign.test.ts](../../../tests/legacy-campaign.test.ts)
- [legacy-configuration.test.ts](../../../tests/legacy-configuration.test.ts)
- [legacy-contact-assignment.test.ts](../../../tests/legacy-contact-assignment.test.ts)
- [legacy-contact-fields.test.ts](../../../tests/legacy-contact-fields.test.ts)
- [legacy-contact-groups.test.ts](../../../tests/legacy-contact-groups.test.ts)
- [legacy-contact-memberships.test.ts](../../../tests/legacy-contact-memberships.test.ts)
- [legacy-contacts.test.ts](../../../tests/legacy-contacts.test.ts)
- [legacy-conversations.test.ts](../../../tests/legacy-conversations.test.ts)
- [legacy-label-management.test.ts](../../../tests/legacy-label-management.test.ts)
- [legacy-messaging.test.ts](../../../tests/legacy-messaging.test.ts)
- [legacy-mobile.test.ts](../../../tests/legacy-mobile.test.ts)
- [legacy-pages.test.ts](../../../tests/legacy-pages.test.ts)
- [legacy-search.test.ts](../../../tests/legacy-search.test.ts)
- [legacy-translations.test.ts](../../../tests/legacy-translations.test.ts)
- [manual-billing.test.ts](../../../tests/manual-billing.test.ts)
- [media-messaging.test.ts](../../../tests/media-messaging.test.ts)
- [message-window.test.ts](../../../tests/message-window.test.ts)
- [meta-flows.test.ts](../../../tests/meta-flows.test.ts)
- [meta-signup.test.ts](../../../tests/meta-signup.test.ts)
- [out-of-office.test.ts](../../../tests/out-of-office.test.ts)
- [password-migration.test.ts](../../../tests/password-migration.test.ts)
- [quoted-replies.test.ts](../../../tests/quoted-replies.test.ts)
- [reactions.test.ts](../../../tests/reactions.test.ts)
- [security.test.ts](../../../tests/security.test.ts)
- [sheets.test.ts](../../../tests/sheets.test.ts)
- [site-settings.test.ts](../../../tests/site-settings.test.ts)
- [store-notifications.test.ts](../../../tests/store-notifications.test.ts)
- [store-orders.test.ts](../../../tests/store-orders.test.ts)
- [tally.test.ts](../../../tests/tally.test.ts)
- [translations.test.ts](../../../tests/translations.test.ts)
- [verification-resend.test.ts](../../../tests/verification-resend.test.ts)
- [worker-reconciliation.test.ts](../../../tests/worker-reconciliation.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
