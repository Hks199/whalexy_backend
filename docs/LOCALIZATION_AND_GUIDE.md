# Localization and workspace setup guide

The Node project is `D:\mombius bloom\whalexy_backend`; original Laravel source remains in `D:\mombius bloom\whalexy`.

## Localization

Legacy language metadata lives in `configurations.name = translation_languages`. Native catalogs use separate `native_translation_catalog:<locale>` rows without a schema migration. Management requires an active central super-administrator session (role 1); workspace owners and API keys are denied.

| Method | URL | Behavior |
|---|---|---|
| GET | `/api/v1/admin/translations` | Language metadata and registry revision |
| POST | `/api/v1/admin/translations` | Create `{locale,name,isRtl}` |
| PATCH | `/api/v1/admin/translations/:locale` | Update `{revision,name?,status?,isRtl?}` |
| DELETE | `/api/v1/admin/translations/:locale` | Delete language/catalog using `{revision}` |
| GET | `/api/v1/admin/translations/:locale/messages` | Raw catalog and revision |
| PUT | `/api/v1/admin/translations/:locale/messages` | Replace entire catalog with `{revision,messages:[{id,text}]}` |
| POST | `/api/v1/admin/translations/:locale/import-po` | Multipart `file` and `revision`; replace entire catalog |
| GET | `/api/v1/admin/translations/:locale/export-po` | Download UTF-8 gettext PO |
| GET | `/api/v1/public/translations` | Enabled installed locales and English fallback |
| GET | `/api/v1/public/translations/:locale` | Published catalog, direction and revision |

Locale aliases normalize (`pt-br` becomes `pt_BR`). Initial catalog revision is `null` for JSON or an empty multipart field for import; subsequent replacements use the returned UUID. Language edits/deletions use the SHA-256 registry revision. Stale writes return `409 TRANSLATION_CONFLICT`; writes share a database lock. English remains the default. Other languages become available after catalog import and become unavailable when disabled/deleted. Empty translations fall back to the source ID.

Duplicate IDs, control characters and changed named/printf placeholders are rejected atomically. Catalogs are bounded to 10,000 entries and 800 KB; PO uploads to 3 MB. PO language headers must match the selected locale. Plural/context/fuzzy/obsolete entries require reconciliation instead of silent dropping. Exports/public responses omit translator identities, comments and source paths. Consumers should render values as text or apply their HTML policy; values are not sanitized HTML.

Ambiguous/invalid legacy rows return reconciliation errors without exposing their values. Registry metadata alone does not activate translations. Credentials and global configuration secrets are never enumerated. Audits omit message contents.

### Original Portuguese catalog

Source: `../whalexy/locale/pt_BR/LC_MESSAGES/messages.po`. Run `npm run migration:translations` to regenerate `migration/translation-import-plan.json` and `migration/translation-import/pt_BR.po`. The prepared copy includes all **5,723** entries, with **three** source placeholder defects corrected: `{{__messageParameter__}}`, `@{{__messageParameter__}}` and `:seconds`. Source paths and translator metadata are removed.

Generation checks the reviewed source hash, validates all entries and roundtrips the output. It never connects to a database or activates translations. Create `pt_BR` if absent and import the prepared PO with the current catalog revision. Original source remains unchanged.

Original Blade/gettext runtime integration, PHP/Blade scanning, plural/context workflows, Microsoft auto-translation, Excel import/export and URL/response contracts remain pending. The source advertises Filipino without an installed PO file; no catalog is fabricated.

## Workspace guide

`GET /api/v1/vendors/:vendorId/guide` requires an owner session plus `administrative` and `vendor.dashboard.view`. Agents, API keys and other businesses are denied. Six checklist items report workspace setup, local WhatsApp connection, approved templates, active contacts, started campaigns/accepted outbound sends and enabled automation.

Connection readiness requires a local `CONNECTED` record and a credential belonging to the same business, number and WABA; tokens/private account IDs are omitted. Draft templates, archived contacts and unconverted legacy graphs do not satisfy readiness. Active native graphs or enabled standalone replies satisfy automation. `showSubscriptionOffer` follows existing base-plan entitlement/expiry; AI-only add-ons do not satisfy it. Reads use a consistent database snapshot. These checks report local state without asserting fresh provider health.

The guide now returns `demoContactEmail` from the configured public contact email; see [site configuration](SITE_CONFIGURATION.md). Original guide Blade content, navigation, mail-from fallback and URL/view contracts remain pending. The source LiveChat controller returns `501`; its absent service cannot establish functional chat parity.
