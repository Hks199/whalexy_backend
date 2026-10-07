# Site configuration and public Home APIs

The dedicated Node Configuration and Home ports use the source `configurations` table. No database model or migration was added. Supported settings keep their Laravel names and data types; hidden secrets are excluded.

## Central configuration

All configuration routes require an active super-administrator bearer session (role 1). Workspace owners, agents and API keys cannot manage global settings.

| Method | URL | Behavior |
|---|---|---|
| GET | `/api/v1/admin/configuration` | List supported groups and keys |
| GET | `/api/v1/admin/configuration/:group` | Return typed values and a revision |
| PATCH | `/api/v1/admin/configuration/:group` | Save supplied values using `{revision,settings:{...}}` |

Supported groups:

- `general`: `name`, `description`, `contact_email`, `contact_details`, `timezone`, `demo_video_link`, `whatsapp_demo_link`.
- `user`: `enable_vendor_registration`, `message_for_disabled_registration`, `user_terms`, `vendor_terms`, `privacy_policy`.
- `misc_settings`: `other_home_page_url`.

Omitted keys retain their values. Empty strings clear optional text/links. Names must be nonempty; email, timezone, text lengths and HTTPS URLs are validated. URLs cannot contain credentials. Native boolean writes require JSON booleans and store Laravel-compatible `1`/`0`; reads also accept legacy `true`/`false` encodings. Legal HTML is sanitized at write and read time.

Revision checks and a PostgreSQL transaction lock prevent concurrent editors from overwriting one another. Stale writes return `409 SETTINGS_CONFLICT`. Duplicate keys, inconsistent source types or invalid legacy values return `409 SETTINGS_REVIEW_REQUIRED` without exposing their values or deleting rows. Reconcile those source rows before continuing. Audits record changed keys, not settings contents.

Payment, SMTP, provider, registration-license and other hidden configuration groups are excluded. Unknown groups return 404; unknown or out-of-group write keys are rejected. Defaults for the native site are Whalexy, UTC, registration enabled and otherwise empty optional content.

## Public behavior

`GET /api/v1/public/home` returns public site metadata, configured contact email/details, timezone, demo links, registration availability, central published menu pages and the three newest currently published blog summaries. Draft, future and deleted articles are excluded. Vendor-owned pages and article bodies are omitted. Responses use a consistent database snapshot.

When `other_home_page_url` is set, `redirectUrl` contains the alternate destination. A destination matching the site's canonical home URL is suppressed to avoid a self-redirect loop. This API returns data; the consuming frontend performs navigation. Clearing the setting clears the destination.

`GET /api/v1/public/policies/:policy` publishes sanitized configured `user_terms`, `vendor_terms` or `privacy_policy`. Empty policies return 404. Canonical URLs follow the original `/terms-and-policies/:policy` route. Other configuration names cannot be requested through this API.

The owner guide now returns `demoContactEmail` from the configured public contact email. It does not expose SMTP credentials or fall back to a private mail-from address.

## Registration enforcement

`POST /api/v1/auth/register` rejects new account/workspace creation with `403 REGISTRATION_DISABLED` when `enable_vendor_registration` is false. It checks before password hashing and again inside the creation transaction under the same settings lock. A disable taking effect during hashing prevents account creation and verification-job enqueueing. Re-enabling registration restores normal creation; email and phone verification remain required. Existing login/session flows are unaffected.

## Remaining source behavior

Original Blade pages/layouts, form/redirect/session/response contracts, site graphics/files/styles, selected home view, static marketing pages/resources, contact submission/reCAPTCHA/email, QR generation, preview pages, server-compiled JavaScript, localization/default-language controls, email-driver configuration, currency/plans, product licensing and Laravel optimization commands still need ports or compatibility review. Source Home behavior also includes closures in `routes/web.php`; controller coverage alone does not establish full public-site parity. Native site APIs have not replaced the original frontend.
