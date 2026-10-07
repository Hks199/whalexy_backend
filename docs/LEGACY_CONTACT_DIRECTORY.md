# Original contact DataTables listing

`GET /vendor-console/contacts/list-data` and `GET /vendor-console/contacts/list-data/:groupUid` adapt one original optional-group Laravel declaration. Both require native bearer authentication, active workspace membership and `vendor.contacts.view`. Assigned-contact visibility applies to rows and counts. Unknown/foreign groups return 404; invalid UUIDs return 400. Multiple workspace memberships require `X-Vendor-Id`.

Responses expose `draw`, `recordsTotal`, `recordsFiltered` and `data` with source-named contact fields. Private contact data and vendor metadata are excluded. Phones are masked and email/social identifiers omitted without phone visibility. Search covers names and, only when permitted, phones, email and social identifiers. Hidden fields never participate in search. Email sorting without phone visibility returns 403.

Supported queries: bounded `draw`, `start`, `length` (1–100), `search[value]`, `search[regex]=false`, one sort column/direction and flat DataTables column descriptors. Source column indices are 2 first name, 3 last name, 9 creation date, 11 email, 12 opt-out and 13 AI state. Sorts use an ID tie-breaker; default ordering is ID ascending. Regex, per-column filtering, additional sorts, unsafe columns and unbounded export are rejected. Creation dates use UTC `dd/mm/yy`; opt-out/AI labels use source English strings. Source locale/date/timezone and broader search behavior are not fully verified.

`platform` defaults to `whatsapp`, including stored null/empty platform values. Facebook includes `facebook` and `messenger`; Instagram includes `instagram`. The service reads stored contacts without calling the source social synchronization provider. Social freshness, imported identity reconciliation and live Meta compatibility remain pending.

For the general WhatsApp directory, optional `from_phone_number_id` filters a connected business number. Group directories retain actual owned memberships across all numbers, including unscoped imported members, regardless of the group's stored number or this query filter. A supplied number must still belong to the workspace. An empty group returns an empty list; imported foreign contacts are excluded. Source browser/session-selected phone scope remains pending; without an explicit number the general directory includes all visible WhatsApp contacts.

Rows, counts and country names use one repeatable-read transaction with fresh actor/vendor/membership/API-key permissions. Original cookies/CSRF, `manage_contacts`, secured/frontend/error contracts, complete DataTables behavior, translations, views and live Laravel comparison remain unverified. These are partial adapters, not verified original frontend compatibility.

Tests: [directory contracts](../tests/legacy-contact-directory.test.ts). Evidence: [contact-directory-test-results.json](../migration/contact-directory-test-results.json).
