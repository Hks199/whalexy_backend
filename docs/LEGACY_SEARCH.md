# Original global search adapters

Two original declarations have partial adapters: `GET /vendor-console/global-search` and `GET /central-console/global-search`.

Both accept only `q`: a trimmed string of at most 100 characters without control characters. Empty queries return an empty array after authorization. Matching is literal and case insensitive; percent and underscore do not act as wildcards. Results retain the source fields `name`, `path`, `url`, `type`, `icon` and optional `subtitle`. Responses use a bare JSON array with `Cache-Control: no-store`.

Vendor search uses native bearer/workspace authentication. Its transaction rechecks active user, vendor, membership and API-key scope. Dashboard access requires `vendor.dashboard.view`. Contact results additionally require `vendor.contacts.view`; without `vendor.chats.view_all`, only contacts assigned to the current user are searched. Phone matching requires `vendor.contacts.view_phone`. Hidden phones are masked in result subtitles and fallback names, and phone queries do not match hidden phone columns.

Order results require both `vendor.orders.manage` and full contact visibility. Orders referring to another vendor's or a missing contact are excluded. Search covers order identifiers/customer names and visible phones. Results contain exact decimal amounts and safe display fields, omitting arbitrary order/contact metadata. Each dynamic category returns at most five records in stable ID order. Only supported Contacts and WhatsApp Orders navigation links are included when matching and permitted. Contact links use the native REST detail endpoint; order links use the converted original detail URL.

Central search requires native bearer authentication as a current active site administrator; API keys are rejected. It searches up to five global site pages and five nondeleted blog posts. Vendor-owned and imported non-site page types are excluded. Content excerpts, bodies, author records and configuration values are not projected. Matching general, user and miscellaneous configuration navigation links point to existing converted endpoints.

Full source parity remains pending. Original cookies/frontend destinations/localization/navigation, all central vendor/admin/subscription/plan search categories and dynamic configuration field search are not ported. Central blog search adds a supported native category. Some destinations return JSON instead of the original Blade pages. Original schema/import and runtime verification remain unverified.

See [tests](../tests/legacy-search.test.ts), [service](../src/modules/dashboard/services/legacy-search.service.ts) and [API backlog](../migration/API_BACKLOG.md).
