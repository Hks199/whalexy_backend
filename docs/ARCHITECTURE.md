# Backend architecture

The backend is organized by feature. Each feature has named HTTP operations, input schemas, authorization middleware and business services. Large features use several workflow service files. There are no flat legacy entry files or duplicate src/lib implementations.

Start with [Reading the code](READING_THE_CODE.md), then use the [Feature index](FEATURE_INDEX.md) to find a workflow.

## Directory layout

```text
src/
  app.ts                     Application assembly
  server.ts                  HTTP startup and shutdown
  worker.ts                  Background worker startup and scheduling
  config/environment.ts      Environment validation
  database/client.ts         Shared Prisma connection
  observability/logger.ts    Pino logger and redaction
  security/tokens.ts         Access token operations
  middleware/                Authentication, validation, errors, platform middleware
  routes/                    Public/admin and vendor route mounts
  http/service-adapter.ts    Request adaptation and response serialization
  validation/common.ts       Shared Joi schemas
  shared/                    Errors, permissions, application contracts and templates
  utils/                     Crypto, passwords and header helpers
  types/http.ts              Identity and Express type augmentation
  infrastructure/providers/ Meta and Stripe clients
  jobs/
    dispatcher.ts            Select the handler for a job kind
    runner.ts                Claim jobs, run them, record outcomes and retries
    recovery.ts              Reconcile interrupted jobs
    handlers/                WhatsApp, email and webhook handlers
    services/                Shared acknowledgement and receipt processing
  modules/<feature>/
    README.md                Feature reading guide, routes and tests
    <feature>.routes.ts      Paths and enforcement order
    <feature>.controller.ts  Named HTTP handlers
    <feature>.validation.ts  Input schemas
    <feature>.middleware.ts  Feature guards and upload handling, when needed
    <feature>.service.ts     Business operations for smaller features
    <feature>.constants.ts   Shared constants, when needed
    services/                Named workflow services and domain helpers
```

Create only the layers a feature needs. Worker-only modules do not have artificial routers or controllers. Larger features place their operations directly in named workflow files under services; they do not retain a duplicate service facade.

## Responsibilities

**Routes** bind URL paths to named controllers. They select authentication, business scope, permissions, validation and upload middleware in the required order. They contain no database queries, schema construction or inline business handlers. Signed raw-body webhook routes must be mounted before the JSON parser in routes/index.ts.

**Controllers** adapt Express input using serviceContext and call explicitly imported operations. HTTP status/envelope serialization uses sendResult. Download, PDF and CSV controllers also own headers, streaming, backpressure and connection closure. Controllers do not query the database.

**Services** perform workflows, persistence and transaction boundaries using plain application inputs. They do not receive Express requests/responses or import controllers, routers or HTTP middleware. Provider effects use infrastructure clients. Use the singleton in database/client.ts; do not create or disconnect database clients per request.

**Validation files** define Joi schemas. The common validation middleware executes them and preserves validated/coerced input. Name schemas after the operation: createContactBodySchema, listContactsQuerySchema or getContactParamsSchema.

**Middleware** owns HTTP enforcement. Authentication may query persisted sessions or memberships. Feature guards have names such as requireBusinessOwner, requireSiteAdministrator and validateContactId. Pure permission checks live in shared/access-policy.ts; token operations live in security/tokens.ts.

**Background jobs** have separate dispatch, claim/retry, recovery and handler files. Handler code owns the relevant workflow; the dispatcher selects the handler. Keep once-only processing, transaction locks and uncertain-effect handling with the operation they protect.

**Logging and errors** are centralized. Configure logging/redaction in observability/logger.ts, application errors in shared/api-error.ts and HTTP error serialization in middleware/error-handler.ts.

## Naming and imports

Use operation names that state the action and subject: listContacts, createContact, cancelCampaign, publishCatalogProduct or registerFlowEncryptionKey. Avoid names such as get2, postService or names generated from a whole callback body. Controllers may alias an imported operation to listContactsService to distinguish it from their exported listContacts HTTP handler.

Import the actual workflow file. Do not introduce src/lib aliases, flat src/modules/*.ts copies or index files that re-export the same implementation through another path. The removed internal import paths are recorded in migration/removed-compatibility-paths.json; symbols renamed during this cleanup are recorded in migration/readability-renames.json and migration/readability-helper-renames.json.

## Adding a feature

1. Define schemas and business operations in the feature folder.
2. Add named controllers and bind them with enforcement middleware in its routes file.
3. Mount the feature router in routes/index.ts or routes/vendor.routes.ts.
4. Keep related operations together; split a growing service by workflow, such as catalog connections, products and messaging.
5. Add behavior tests against the isolated test database and mock external effects.
6. Run npm run docs:structure, npm run format and npm run check.

Architecture checks reject duplicate old entry files, unresolved internal imports, generic handler names, inappropriate layer imports, inline route handlers, additional PrismaClient construction sites and static runtime import cycles. Formatting includes application code, tests and reading guides. Builds remove stale dist files before compiling.

## Scope

This structure organizes the existing native Node backend. Dynamic application input types inherited from Joi-driven code remain; fully typed per-operation DTOs are a separate improvement. The structural cleanup does not establish Laravel/frontend/provider/data parity. See migration/FEATURE_PARITY.md for those requirements.

Historical extraction tools live in migration/tools, outside the normal development scripts. The ignored .architecture-backup directory retains local snapshots for review; it is excluded from Docker builds.
