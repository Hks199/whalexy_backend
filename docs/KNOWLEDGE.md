# AI knowledge APIs

The [knowledge feature](../src/modules/knowledge/README.md) implements document upload, public website ingestion, document listing and deletion. It forwards requests to the configured AI engine using `WHALEXY_AI_SERVICE_URL` and `WHALEXY_AI_API_KEY`; no environment files or credentials are activated by the migration.

Every operation requires an active native business membership, `vendor.ai.manage`, an active base subscription and an active paid/administrator AI Replies entitlement.

| Method | Native URL                                        | Original Laravel URL adapter           |
| ------ | ------------------------------------------------- | -------------------------------------- |
| POST   | `/api/v1/vendors/:vendorId/knowledge/upload`      | `/api/v1/vendor/knowledge/upload`      |
| POST   | `/api/v1/vendors/:vendorId/knowledge/website`     | `/api/v1/vendor/knowledge/website`     |
| GET    | `/api/v1/vendors/:vendorId/knowledge/list`        | `/api/v1/vendor/knowledge/list`        |
| DELETE | `/api/v1/vendors/:vendorId/knowledge/:documentId` | `/api/v1/vendor/knowledge/:documentId` |

The existing `/api/v1/vendors/:vendorId/ai/knowledge` read/delete APIs remain available with their earlier native response contracts.

Uploads use multipart field `file`, with a maximum size of 10 MB and no extra form fields. Supported types are PDF, DOCX and UTF-8 TXT. Content inspection must match the file extension; arbitrary ZIP archives, binary text and spoofed MIME declarations are rejected. Filenames are reduced to their basename and control characters are removed. The provider receives multipart `file`, `title`, `category=general` and `language=en`; the internal API key stays in the provider request header.

Website ingestion accepts `websiteUrl` or the original `website_url`, plus optional `title`. Only public HTTP(S) hostnames with default ports are accepted. Credentials, literal IP addresses, local hostnames and fragments are rejected. DNS must resolve exclusively to public addresses. The backend forwards the URL to the AI engine; the engine must enforce its own network restrictions, validate DNS at connection time and validate every redirect. Local preflight checks do not verify the remote crawler's protection against DNS rebinding or redirects.

Upload and website requests require an `Idempotency-Key` of 8–100 letters, digits, underscores or hyphens. A durable business/operation-scoped claim is committed before ingestion. Identical accepted replays return the saved acknowledgement; changed content conflicts. Concurrent or uncertain/rejected claims return 409 and cannot automatically repeat a provider effect. Timeouts, malformed acknowledgements and interrupted local acknowledgement writes retain the claim. Review the provider document list before choosing a new key after an uncertain result. This work does not add automatic provider reconciliation.

Accepted uploads return 200, accepted website ingestion returns 202, listing returns `{ "success": true, "documents": ... }`, and successful deletion returns 200 with a success message. Provider errors are redacted. Acknowledgement means the AI engine accepted the operation; indexing completion must be checked through its document listing.

Original URL adapters require native bearer sessions or native scoped API keys. A bearer user with exactly one active membership can omit workspace selection. Users with multiple memberships must send `X-Vendor-Id`. API-key callers must also send `X-Vendor-Id`; it is checked against the key's business and the current membership. Laravel cookies/session state are not interpreted.

The original Laravel ingestion URLs did not require an idempotency header. Native credentials, explicit multi-workspace selection, request-key requirements, public website checks, stricter content checks and provider error responses therefore remain compatibility differences. These adapters are partial implementations, not accepted legacy-equivalence evidence. Live provider indexing/crawling remains unverified.

[HTTP tests](../tests/knowledge.test.ts) cover all four original URLs, multipart payloads, file type/size checks, DNS restrictions, subscriptions, workspace selection, API keys, concurrent claims and uncertain effects.
