# Reading the code

Use this sequence to understand a request before exploring individual helpers.

## Start here

1. [server.ts](../src/server.ts) starts HTTP and owns shutdown. [worker.ts](../src/worker.ts) starts background processing.
2. [app.ts](../src/app.ts) assembles middleware, routes and error handling.
3. [routes/index.ts](../src/routes/index.ts) mounts health, webhooks, public, admin and authentication routes. [routes/vendor.routes.ts](../src/routes/vendor.routes.ts) mounts business-scoped features.
4. Open the feature?s README in the [feature index](FEATURE_INDEX.md). It lists route prefixes, route operations, workflow files and tests.

## Example: create a contact

The HTTP endpoint is POST /api/v1/vendors/:vendorId/contacts.

| Step       | File                                                                     | What to look for                                                         |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Mount      | [vendor.routes.ts](../src/routes/vendor.routes.ts)                       | The /contacts mount and business authentication/scope                    |
| Route      | [contacts.routes.ts](../src/modules/contacts/contacts.routes.ts)         | Permission, createContactBodySchema validation, createContact controller |
| Input      | [contacts.validation.ts](../src/modules/contacts/contacts.validation.ts) | Allowed fields, types and normalization                                  |
| Controller | [contacts.controller.ts](../src/modules/contacts/contacts.controller.ts) | createContact calls the explicitly imported createContactService         |
| Workflow   | [contacts.service.ts](../src/modules/contacts/contacts.service.ts)       | Owned-number/country checks, persistence and safe presentation           |
| Database   | [database/client.ts](../src/database/client.ts)                          | Shared Prisma client; models are in prisma/schema.prisma                 |
| Output     | [http/service-adapter.ts](../src/http/service-adapter.ts)                | Existing status codes, envelopes and response format                     |

For a larger example, open [campaigns](../src/modules/campaigns/README.md). Its controller imports operations from campaign-management, campaign-lifecycle, campaign-delivery and campaign-reporting service files. There is no large all-purpose campaign service or duplicate entry path.

## Follow background work

[worker.ts](../src/worker.ts) calls [runner.ts](../src/jobs/runner.ts), which claims a job and calls [dispatcher.ts](../src/jobs/dispatcher.ts). The dispatcher selects a handler or a named domain operation. Delivery handlers live in [jobs/handlers](../src/jobs/handlers); interrupted-job handling lives in [recovery.ts](../src/jobs/recovery.ts).

## Shared code

| Concern                           | Location                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Environment/configuration         | [environment.ts](../src/config/environment.ts)                                                     |
| Logging/redaction                 | [logger.ts](../src/observability/logger.ts)                                                        |
| Authentication and business scope | [auth.ts](../src/middleware/auth.ts)                                                               |
| Reusable validation               | [common.ts](../src/validation/common.ts), [validation middleware](../src/middleware/validation.ts) |
| Application errors                | [api-error.ts](../src/shared/api-error.ts)                                                         |
| HTTP error handling               | [error-handler.ts](../src/middleware/error-handler.ts)                                             |
| Provider clients                  | [infrastructure/providers](../src/infrastructure/providers)                                        |
| General utilities                 | [utils](../src/utils)                                                                              |
| Database definitions/migrations   | [Prisma schema](../prisma/schema.prisma), [migrations](../prisma/migrations)                       |

Read tests alongside the workflow. Each feature guide links tests that import that feature. Run npm run architecture:check to validate boundaries, npm run typecheck for TypeScript, and npm test -- tests/<file>.test.ts for focused behavior checks. Use npm run check for the full verification sequence.
