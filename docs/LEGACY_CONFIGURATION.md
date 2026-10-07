# Original central configuration adapters

Two original declarations have partial Node adapters:

| Method | Path                                                                   | Supported behavior                    |
| ------ | ---------------------------------------------------------------------- | ------------------------------------- |
| GET    | `/central-console/configuration/:pageType`                             | Read the supported group as safe JSON |
| POST   | `/central-console/configuration/:pageType/process-configuration-store` | Update submitted supported fields     |

`pageType` is restricted to `general`, `user` and `misc_settings`. See [setting definitions](../src/modules/configuration/services/site-settings.ts) for the exact whitelist. General supports name, description, contact email/details, timezone and demo links. User supports registration controls and sanitized terms/privacy HTML. Miscellaneous supports the external home-page URL. Omitted fields keep their current values.

Use native bearer authentication as an active site administrator. Each transaction checks the current user status and role; API keys are rejected. Reads return `{reaction: 1, message: '', data: {pageType, revision, ...settings}}`, without raw configuration rows or private configuration values.

Writes accept flattened source field names alongside the matching `pageType` and the SHA-256 `revision` returned by a read. Include an `Idempotency-Key` of 8–100 letters, digits, underscores or hyphens. Checkbox values accept booleans, `on`/`off` and `1`/`0`. Unknown fields, unsupported groups and invalid email/timezone/URL values are rejected. URLs require HTTPS without credentials. Legal HTML uses the same sanitizer as native settings.

Native and legacy writes share validation, the settings lock, revision checks and atomic audit. Legacy responses and replay records commit with the mutation. Repeating an identical normalized request returns the original response; reusing its key for a different request fails. Stale revisions, duplicate or malformed configuration rows require a fresh read or reconciliation.

These endpoints do not establish full legacy compatibility. Original Blade views, sessions, full configuration forms, activation/photo rules, localized client/error behavior, payment/licensing/provider-secret/operational groups and remaining billing rules still need ports. Imported data and live source/provider compatibility remain unverified. The GET page URL supplies JSON, so the original frontend requires changes.

[Adapter tests](../tests/legacy-configuration.test.ts) cover field projection, checkbox normalization, replay, conflicting revisions, authorization revocation, strict input, duplicate rows and audit rollback. [Native settings tests](../tests/site-settings.test.ts) cover shared settings and public-site behavior. See [API backlog](../migration/API_BACKLOG.md) for remaining declarations.
