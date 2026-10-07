# Native contact data workflows

Contact create/edit accepts `countryId` (an existing global country ID or null). Invalid references are rejected before writing. Custom-value edits retain the existing `PUT /contacts/:id/custom-values` shape: `values` contains unique `fieldId`/`value` pairs. All fields must belong to the current business; the contact must be visible to the caller. Supported types match the source `contact_custom_input_types`: text, number, email, URL, date, time and local date/time. Values are trimmed, bounded to 4,000 characters and validated before any writes; null or empty strings clear an optional value. Field definitions are locked against updates/deletion until the transaction commits. Audits contain identifiers, not entered values.

Date/time and HTTP/HTTPS-only URL validation is intentionally stricter than parts of Laravel. Numeric values remain strings, including large values and bounded exponent notation. Bot questions share these type validators while retaining their existing question-specific length and required-answer rules. Imported unsupported types require reconciliation; existing source values are not automatically rewritten.

## CSV import

`POST /contacts/import` accepts the existing `csv`, optional `groupId` and optional connected `phoneNumberId`. Size/row limits remain 900,000 characters and 5,000 rows; records support at most 108 columns and 65,536 characters. All references and rows are resolved inside the import transaction before contacts are created.

Supported core headers include the existing native names plus source aliases such as `Full Name`, `Mobile`, `Language`, `Country`, `Groups` and `countries__id`. Country names and ISO references must resolve uniquely; `countryId`/`countries__id` selects a numeric ID. Do not include both name and ID columns.

Custom columns use an owned exact `input_name`, or `custom:input_name` to disambiguate a core name (for example `custom:phone`). Names must be safe identifiers and uniquely owned. Ownership/internal headers are rejected. Duplicate aliases or mappings are rejected. Supported custom-field types are validated using the current locked definition.

Group cells contain comma-separated existing titles or a JSON string array. JSON arrays preserve titles containing commas. At most twenty titles per contact and 500 distinct references per import are supported. Groups must be active and owned, either unscoped or in the selected business-number scope; ambiguous global/scoped titles are rejected. Group columns require group management and full contact visibility. The explicit target group is combined with column groups without duplicate links. No groups are silently created. Archived targets and mismatched number scopes are rejected.

Existing contacts in the selected WhatsApp/number scope are skipped, including their country, values and memberships. Import-only permission cannot update them. New contacts belong to the importing agent when that user lacks full chat visibility. Invalid rows, types or references reject the entire transaction without partial contacts, values, memberships or import audit. An import audit records only counts and selected field IDs. At most 250 distinct country references are resolved per request.

## CSV export

`GET /contacts/export` preserves the five-column native export. `?extended=true` additionally exports `countryId`, `groups` and all owned custom fields ordered by ID. Field IDs select values, so creation order and missing values cannot shift columns. Extended export requires at most 100 safe, uniquely named fields; reconcile unsupported/ambiguous names before exporting.

Only visible contacts are included. Phones are masked and emails/custom values are blank when the caller lacks `vendor.contacts.view_phone`. Foreign or incompatible group links are excluded; archived groups are excluded. Group values use JSON arrays. Spreadsheet formula prefixes are escaped in all cells; protected negative/positive numeric custom values can be imported again. Protective apostrophes in text remain text, so this is not a byte-identical text round trip. CSV reads use bounded pages and normal stream backpressure, not a historical snapshot; field definitions and membership data should remain stable during export.

The Laravel references are ContactEngine's export/import and custom-field storage paths, ContactCustomFieldEngine, and `config/__tech.php`. The native endpoints intentionally differ from Laravel's XLSX files, updates to existing rows, implicit group creation, error/redirect/view contracts and general custom-value storage. Original Excel/frontend/legacy contracts, original field-definition contracts and plan limits, source typed-data reconciliation, stable historical export snapshots and complete phone-scope reconciliation remain pending. No legacy route is marked verified by this implementation.

Tests: `tests/contact-data.test.ts` covers supported types/clearing, atomic rejection, privacy, field isolation, concurrent updates, country references, source header aliases, compatible groups, malformed/ambiguous references, preserved existing contacts, protected extended exports, column identity and native reimport. Existing contact and bot-question suites cover regression behavior.

Native definition management is now covered by [custom-field definitions](CONTACT_FIELDS.md); legacy lifecycle equivalence and subscription entitlements still require verification.
