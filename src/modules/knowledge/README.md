# knowledge

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router          | Mounted prefix                        |
| --------------- | ------------------------------------- |
| knowledgeRouter | `/api/v1/vendor/knowledge`            |
| knowledgeRouter | `/api/v1/vendors/:vendorId/knowledge` |

## Files to read

### Routes

- [knowledge.routes.ts](knowledge.routes.ts)

### Controllers

- [knowledge.controller.ts](knowledge.controller.ts)

### Validation

- [knowledge.validation.ts](knowledge.validation.ts)

### Middleware

- [knowledge.middleware.ts](knowledge.middleware.ts)

### Services and domain helpers

- [knowledge.service.ts](knowledge.service.ts)
- [services/knowledge-website.service.ts](services/knowledge-website.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router          | Method | Relative path  | Controller              |
| --------------- | ------ | -------------- | ----------------------- |
| knowledgeRouter | POST   | `/upload`      | uploadKnowledgeDocument |
| knowledgeRouter | POST   | `/website`     | addKnowledgeWebsite     |
| knowledgeRouter | GET    | `/list`        | listKnowledgeDocuments  |
| knowledgeRouter | DELETE | `/:documentId` | deleteKnowledgeDocument |

## Behavior tests

- [billing.test.ts](../../../tests/billing.test.ts)
- [knowledge.test.ts](../../../tests/knowledge.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
