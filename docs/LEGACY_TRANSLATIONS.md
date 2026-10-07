# Original translation URL adapters

Six original central-console URLs now have partial Node adapters.

| Method | Path under `/central-console/translations` | Behavior                                                             |
| ------ | ------------------------------------------ | -------------------------------------------------------------------- |
| GET    | `/`                                        | Safe language registry and revision JSON                             |
| GET    | `/language/{languageId}`                   | Language metadata, catalog revision and singular translation entries |
| POST   | `/process-language-store`                  | Create language using `language_id`, `language_name`, `is_rtl`       |
| POST   | `/process-language-update`                 | Update original dynamic form fields with optimistic revision         |
| POST   | `/{languageId}/process-language-delete`    | Delete language/native catalog with registry revision                |
| POST   | `/update`                                  | Update or clear one existing singular catalog entry                  |

Native bearer authentication and current site-administrator role are required; API keys and vendor owners cannot administer global translations. Writes share native transaction helpers, recheck administrator status and hold the global translation lock. Each legacy write requires `Idempotency-Key` (8?100 letters, digits, underscores or hyphens). Mutation, audit and administrator-scoped replay commit together. The replay is stored in a native-marked configuration entry; imported duplicate/malformed records fail closed. Changed payloads or concurrent revisions conflict.

Create accepts source locale/name length limits and true/false RTL flags. Existing native locale normalization, uniqueness and English protection apply. It creates a native language registry entry; automatic source scanning and provider translation are not performed. Unsupported `auto_translate` values fail explicitly.

Update accepts `form_key`, `language_name_{form_key}`, `is_rtl_{form_key}`, `status_{form_key}` and the registry `revision` returned by the language list. The raw key is bounded and validated before dynamic fields are constructed; the locale is then canonicalized. Delete also requires the current registry revision. Replaying deletion succeeds after the language/catalog is gone.

Single-message update accepts `language_id`, `message_id`, `message_str`, optional `is_plural: false`, and the catalog `revision` returned by the message list. It edits only an existing entry, preserves all other messages and enforces placeholder/control-character/size checks. Unknown messages require native catalog import or reconciliation before editing; they do not silently create or scan source strings. Clearing a translation uses empty or null text. Native whole-catalog writes also recheck administrator status inside their transactions.

GET routes expose JSON instead of the original Blade pages. Raw configuration/replay rows are excluded. Native catalog storage is used instead of runtime-generated PO/MO files. Original string scanning, automatic translation providers, plural/context entries, Excel import/export, compiled filesystem/client bundles, session/error/localization/frontend and source catalog compatibility remain pending. These six records remain partial adapters. See [API backlog](../migration/API_BACKLOG.md).
