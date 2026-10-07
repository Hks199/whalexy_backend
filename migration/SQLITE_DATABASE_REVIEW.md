# SQLite reconciliation

Source: `D:\mombius bloom\whalexy\database\database.sqlite`. Read-only integrity check passed with no declared foreign-key violations. The file contains 124 tables and 1,450 rows; its SHA-256 is recorded in sqlite-schema-audit.json.

Migration 008 added eight missing tables and 61 missing columns, and renamed seven incorrectly reconstructed columns while retaining existing Node data. Native API field names remain stable: phoneNumber now maps to mobile_number, whatsappMessageId to wamid, template languageCode to language, and subscription vendorId to vendor_model__id. Activity/login identity columns were corrected too. All SQLite table/column names and all 183 declared foreign-key links are covered by Prisma. There are 137 models: 124 snapshot tables, token_registry and 12 native operational models.

The eight added tables are login_attempts, message_labels, migrations (LegacyMigrations), password_resets, subscription_items, tickets, transactions and user_settings. Laravel migration history stays separate from Prisma's migration history.

All 1,450 source rows are preserved in PostgreSQL's separate legacy_archive schema. Each SQLite cell retains its storage type: integers use exact decimal strings, real numbers use hexadecimal floating-point strings, blobs use base64, and text/null values remain exact. Every archived row was read back and checked against its SHA-256. Repeated archive runs verify existing rows without replacing them. The source file is unchanged. Application APIs do not expose this archive, and historical accounts, credentials, tokens and campaigns are not activated by archival.

Native application import remains incomplete. The metadata audit identifies 235 nullability differences, 17 native-only columns and these 11 categories of import issues:

- Five campaigns reference missing templates; two contacts and 31 vendor settings reference missing businesses under native foreign keys.
- 256 activity values require conversion from plain text to the native JSON representation.
- Five bot priorities, one campaign status, one group status and all 39 contact statuses are NULL; source meaning must be translated explicitly.
- Seventeen users need their native display name derived from source first/last names.
- Ten message records have no contact link and 16 have no message timestamp.

Account memberships and permissions, numeric campaign/subscription states, legacy provider credentials, date interpretation, types/defaults/unique constraints and decimal/key widths also need reviewed mappings. A raw archive is not evidence that the native application can operate correctly on imported data. The four global acceptance requirements remain false, and full backend conversion is still incomplete.

## Native import validation on 2026-10-03

The native importer now validates field types, numeric/decimal bounds, UTC dates, uniqueness and parent references before loading. It reads SQLite through the existing read-only snapshot exporter; it does not print source rows or credentials. `npm run db:import-plan` reports the plan. `npm run db:import-validate` loads only the separate local PostgreSQL database `whalexy_import_validation`, refusing to overwrite populated tables. `node scripts/native_sqlite_import.mjs --verify` performs read-back verification without creating a database or deploying migrations.

The executed validation imported **1,400 rows** and verified every explicitly transformed field. **50 rows** remain in the private `legacy_import.quarantine` table with exact payloads and verified hashes: 10 messages without required contacts, 5 campaigns without templates, 33 contact/settings rows without businesses and 2 messages referencing those excluded campaigns. No missing parent is invented and no record is silently skipped. The importer restores PostgreSQL sequences after explicit source IDs and restores 15 source role-2 business-owner memberships. It does not give the global administrator a business membership or invent an agent's business association.

Policies derive user names, preserve plain activity text as JSON scalar strings, map missing contact/group statuses to inactive status 5, default missing bot priorities to zero and derive available message timestamps from creation dates. Legacy campaigns are paused and flows disabled pending executable configuration conversion. Original password hashes and actual email/phone verification proofs are preserved; no verification bypass is created. Provider credentials are retained without activation. Source permission defaults and classification presets are extracted with a literal parser, without executing PHP.

The report is [native-import-report.json](native-import-report.json). This establishes a reviewed import into a separate validation database, not a production data cutover or complete application behavior on every legacy record. Quarantined references, historical campaign/flow configuration conversion and credential activation remain outstanding.

Migration 202610030002 subsequently added node_meta_flows for provider-backed native flow ownership/cache, bringing the current Prisma model count to 138 and native operational table count to 13. It is applied in development, test and native import validation. Original source rows and mappings remain unchanged; native import field/quarantine/membership verification was rerun successfully after this migration.
