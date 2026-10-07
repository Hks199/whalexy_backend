# Original central page management adapters

Six original central page declarations now have partial Node adapters under `/central-console/pages`.

| Method | Path                             | Behavior                                                     |
| ------ | -------------------------------- | ------------------------------------------------------------ |
| GET    | `/`                              | Bounded JSON listing at original page URL                    |
| GET    | `/list-data`                     | Safe site-page DataTables projection                         |
| GET    | `/{pageIdOrUid}/get-update-data` | Sanitized edit fields and revision                           |
| POST   | `/add-process`                   | Create using original title/slug/description/checkbox fields |
| POST   | `/update-process`                | Update using body `pageIdOrUid` and revision                 |
| POST   | `/{pageIdOrUid}/delete-process`  | Delete with revision and idempotent replay                   |

Native bearer authentication and current site-administrator access are required. Vendor owners and API keys cannot use these adapters. Global site pages have `vendorId: null`; vendor pages are excluded from read/write scope. Native page create/update/delete share current transaction-level authorization, site ownership checks, global content-management locking and atomic audit. Imported page types other than null/1 cannot be overwritten or deleted through site-page operations. Existing image metadata is preserved during ordinary edits.

Create/update accept `title` (2?255 characters), ASCII alphanumeric `slug` (up to 255), `description` (2?500,000), `show_in_menu`, and `status`. Source `on` checkboxes and native true/false values map to 1/0; omission disables publication/menu visibility. HTML is sanitized through the existing content processor. Slug uniqueness includes existing vendor pages, matching source global uniqueness. Public native reads continue to enforce publication and sanitize imported HTML.

Every legacy write requires `Idempotency-Key` (8?100 letters, digits, underscores or hyphens). Administrator-scoped native-marked replay records commit with the mutation/audit. Replays recheck access; changed payloads or concurrent transactions return conflicts. Updates/deletes require the `revision` returned by edit/list/create responses. Native writes can invalidate that revision; stale edits cannot overwrite them. Delete replay succeeds after the page is removed. Native routes retain their response/status contracts.

DataTables defaults to 25 rows and caps at 100. Source bracket queries are bounded/normalized, search treats SQL wildcard characters literally, supported single-column sorting has a deterministic ID tie break, and regex/column search/unsafe columns fail. Projection includes original IDs, title/slug, sanitized content/description, status/menu flags, ISO dates and revision. Arbitrary vendor/image/provider metadata is excluded.

These records are partial adapters. Original Blade/session/roles/error/localization, rendered table labels/preview links/client models, advanced filters, Unicode source slug rules, imported non-site configuration and complete source/schema runtime parity remain pending. See [API backlog](../migration/API_BACKLOG.md).
