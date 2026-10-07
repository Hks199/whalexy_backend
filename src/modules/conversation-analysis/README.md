# conversation-analysis

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                     | Mounted prefix                           |
| -------------------------- | ---------------------------------------- |
| conversationAnalysisRouter | `/api/ai`                                |
| conversationAnalysisRouter | `/api/v1/vendors/:vendorId/intelligence` |

## Files to read

### Routes

- [conversation-analysis.routes.ts](conversation-analysis.routes.ts)

### Controllers

- [conversation-analysis.controller.ts](conversation-analysis.controller.ts)

### Validation

- [conversation-analysis.validation.ts](conversation-analysis.validation.ts)

### Services and domain helpers

- [conversation-analysis.service.ts](conversation-analysis.service.ts)
- [services/analysis-result.service.ts](services/analysis-result.service.ts)
- [services/analysis-worker.service.ts](services/analysis-worker.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                     | Method | Relative path                            | Controller                  |
| -------------------------- | ------ | ---------------------------------------- | --------------------------- |
| conversationAnalysisRouter | POST   | `/analyze-conversation`                  | requestConversationAnalysis |
| conversationAnalysisRouter | GET    | `/conversation-analysis/:conversationId` | getConversationAnalysis     |

## Behavior tests

- [billing.test.ts](../../../tests/billing.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [conversation-analysis.test.ts](../../../tests/conversation-analysis.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
