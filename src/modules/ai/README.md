# ai

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router   | Mounted prefix                 |
| -------- | ------------------------------ |
| aiRouter | `/api/v1/vendors/:vendorId/ai` |

## Files to read

### Routes

- [ai.routes.ts](ai.routes.ts)

### Controllers

- [ai.controller.ts](ai.controller.ts)

### Validation

- [ai.validation.ts](ai.validation.ts)

### Middleware

- [ai.middleware.ts](ai.middleware.ts)

### Services and domain helpers

- [ai.service.ts](ai.service.ts)
- [services/ai-entitlement.service.ts](services/ai-entitlement.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router   | Method | Relative path    | Controller              |
| -------- | ------ | ---------------- | ----------------------- |
| aiRouter | POST   | `/reply`         | generateAiReply         |
| aiRouter | GET    | `/knowledge`     | listKnowledgeDocuments  |
| aiRouter | DELETE | `/knowledge/:id` | deleteKnowledgeDocument |
| aiRouter | POST   | `/support`       | requestAiSupport        |

## Behavior tests

- [billing.test.ts](../../../tests/billing.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [conversation-analysis.test.ts](../../../tests/conversation-analysis.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
