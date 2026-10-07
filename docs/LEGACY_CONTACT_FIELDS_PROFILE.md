# Original contact field, note and label adapters

Eleven original Laravel JSON routes now have partial Node adapters. They use native bearer authentication and an active workspace membership. If the user belongs to several businesses, select one using `X-Vendor-Id`. Reads require `vendor.contacts.view`; writes require `vendor.contacts.edit`. Contact notes/labels also enforce assigned-contact visibility unless the actor has `vendor.chats.view_all`. Label catalog mutations require `vendor.groups.manage` and `vendor.chats.view_all`. These policies differ from the original `manage_contacts`/`messaging` permission model.

| Method | Path                                                                                | Input / result                                                                      |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/vendor-console/contacts/custom-fields/list-data`                                  | Bounded DataTables list with `draw`, `recordsTotal`, `recordsFiltered`, `data`      |
| POST   | `/vendor-console/contacts/custom-fields/add-process`                                | `input_name`, `input_type`; HTTP 201 and safe `field`                               |
| GET    | `/vendor-console/contacts/custom-fields/:contactCustomFieldIdOrUid/get-update-data` | Numeric ID or UUID; source-named field with `updated_at`                            |
| POST   | `/vendor-console/contacts/custom-fields/update-process`                             | `contactCustomFieldIdOrUid`, `input_name`, `input_type`, `revision`; HTTP 200       |
| POST   | `/vendor-console/contacts/custom-fields/:contactCustomFieldIdOrUid/delete-process`  | Numeric ID or UUID and `revision`; HTTP 200                                         |
| POST   | `/vendor-console/whatsapp/contact/chat/update-notes`                                | UUID `contactIdOrUid` and optional `contact_notes`; HTTP 200                        |
| GET    | `/vendor-console/whatsapp/contact/labels/:contactUid`                               | Visible contact UUID; paginated `listOfAllLabels` catalog                           |
| POST   | `/vendor-console/whatsapp/contact/chat/assign-labels`                               | UUID `contactUid`, optional numeric-ID array `contact_labels`; HTTP 200             |
| POST   | `/vendor-console/whatsapp/contact/create-label`                                     | `title`, optional `text_color`/`bg_color`; HTTP 201 and `createdLabel`              |
| POST   | `/vendor-console/whatsapp/contact/chat/edit-label`                                  | UUID `labelUid`, `title`, optional `text_color`/`bg_color`; HTTP 200 and `labelUid` |
| POST   | `/vendor-console/whatsapp/contact/chat/delete-label/:labelUid`                      | Owned UUID; optional matching body `labelUid`; HTTP 200 and `labelUid`              |

## Field definitions

Field projections contain `_id`, `_uid`, `input_name`, `input_type`, `created_at` and `updated_at`. Creation/update returns `{ status: "success", message, field }`; deletion returns `{ status: "success", message }`. Update and deletion require `revision` equal to the previously read `updated_at`. Stale revisions fail with HTTP 409. This requirement is an intentional native safeguard and requires an original frontend change.

The seven original configured types are supported: text, number, email, URL, date, time and datetime-local. Native identifier validation rejects reserved names, hyphens and names outside the 64-character safe identifier format. Original alpha-dash validation was broader. Names must be unique within a business; native and original writes share the same definition lock. The native 100-definition cap is retained; original subscription-specific limits are not implemented by this adapter.

Type changes must match existing values. Rename/type changes and deletion reject referenced bot/campaign fields. Deletion refuses populated values and cross-business imported references; safe empty value rows are removed with the definition and audit event in one transaction. Large or deeply nested imported references require reconciliation. The adapter delegates these rules to the existing native lifecycle rather than creating a second mutation path.

Listing supports flat DataTables query parameters: `draw`, `start`, `length` (1-100), `search[value]`, `search[regex]=false`, `order[0][column]` (0=input name, 1=input type) and `order[0][dir]`. Common `columns[...]` descriptors are accepted, but nonempty per-column search, regex, multiple sorts and unbounded `length=-1` are rejected. Search covers owned input names/types. Sorts have an ID tie-breaker. Raw SQL, server identity fields and unknown input are rejected.

## Notes and labels

Notes use the original `contact_notes` storage key and preserve other contact JSON. Omitted/null notes clear the note; text is bounded to 10,000 characters.

The original label lookup returns the whole workspace catalog, not just labels assigned to the contact. The adapter retains that meaning and adds `total`, `page`, `limit` and `has_more`; page size defaults to 100 and cannot exceed 100. Labels expose only `_id`, `_uid`, `title`, `text_color`, `bg_color` and `status`. Catalog access requires the requested contact to exist and be visible, which is stricter than the original lookup.

Label assignment replaces the visible contact's selection in one transaction. Omitted/null selection clears it. Duplicate, foreign, unavailable or inactive labels fail before any existing assignment is removed. This differs from the source's silent foreign-label skipping. Repeating an unchanged assignment returns success rather than the original no-change reaction code.

Original cookies/CSRF/secured envelopes, Blade views, client model/reload/realtime events, translations, permission aliases, subscription limits, group workflows and live Laravel comparison remain pending. These are partial adapters, not fully verified contracts.

## Label lifecycle

The three original label-management URLs now use a shared native service. Native resource-label POST/PATCH writes use this service too, so those paths cannot bypass title uniqueness, styling validation, scope checks or atomic auditing. Existing read/list paths retain their behavior. Native writes accept camel-case `textColor`, `bgColor` and `color`, and status 1 or 2; source creates always use status 1.

Titles are trimmed, nonempty and limited to the original 45-character bound. Exact title uniqueness is checked under a per-business advisory lock for both creation and editing, excluding the edited label itself. Case sensitivity follows the current PostgreSQL comparison and still requires original database-collation review. Colors allow 3/4/6/8-digit hex strings or empty/null values. Arbitrary CSS strings accepted by the source are rejected. Source edits clear omitted colors to null; native partial edits preserve omitted values.

Inside the locked transaction, mutation rechecks current active user/business/membership, group-management/full-contact-visibility permissions and API-key expiry/revocation/permission intersection. Native assignment and catalog mutations share the label lock. Conflict may require retrying an assignment after a concurrent deletion; no orphan link is returned as success.

Deletion refuses cross-business imported contact links. Owned assignments, the label and its audit commit together. If audit insertion fails, all local changes roll back. A mismatched body label UUID cannot select a different label from the URL. Missing/previously deleted labels return HTTP 404 rather than the source no-change reaction. Source client-model `allLabels` refresh/realtime behavior remains pending; clients can reload the paginated label catalog.

Tests: [label lifecycle](../tests/legacy-label-management.test.ts), [original field adapters](../tests/legacy-contact-fields.test.ts), [original notes/labels](../tests/legacy-contact-profile.test.ts), [native field lifecycle](../tests/contact-fields.test.ts) and [native contact workflows](../tests/contact-workflows.test.ts). Scoped results: [contact-adapters-test-results.json](../migration/contact-adapters-test-results.json).

Label-management scoped evidence: [label-management-test-results.json](../migration/label-management-test-results.json).
