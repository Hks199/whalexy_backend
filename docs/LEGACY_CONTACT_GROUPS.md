# Original contact-group JSON adapters

Twelve original route declarations now have partial Node adapters. Native bearer authentication, workspace membership and `vendor.groups.manage` plus `vendor.chats.view_all` are required. Multiple memberships require `X-Vendor-Id`. These differ from the original `manage_contacts` permission and cookie/CSRF/session policies.

| Method | Path                                                                     | Input/result                                                                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| GET    | `/vendor-console/contacts/groups/list-data`                              | Active workspace groups, bounded DataTables response                                         |
| GET    | `/vendor-console/contacts/groups/:status/list-data`                      | `active` or `archived`; alternate path for the same original optional-status declaration     |
| POST   | `/vendor-console/contacts/groups/add-process`                            | `title`, optional `description`; HTTP 201 with safe `group`                                  |
| GET    | `/vendor-console/contacts/groups/:contactGroupIdOrUid/get-update-data`   | Numeric ID or UUID; safe source-named group                                                  |
| POST   | `/vendor-console/contacts/groups/update-process`                         | `contactGroupIdOrUid`, `title`, optional `description`; HTTP 200                             |
| POST   | `/vendor-console/contacts/groups/:contactGroupIdOrUid/delete-process`    | Empty body; delete owned group memberships and definition, retaining contacts                |
| POST   | `/vendor-console/contacts/groups/:contactGroupIdOrUid/archive-process`   | Empty body; set status 5                                                                     |
| POST   | `/vendor-console/contacts/groups/:contactGroupIdOrUid/unarchive-process` | Empty body; set status 1                                                                     |
| POST   | `/vendor-console/contacts/groups/delete-selected-process`                | `selected_groups`: 1-100 unique owned UUIDs                                                  |
| POST   | `/vendor-console/contacts/groups/archive-selected-process`               | Same selection, status 5                                                                     |
| POST   | `/vendor-console/contacts/groups/unarchive-selected-process`             | Same selection, status 1                                                                     |
| POST   | `/vendor-console/contacts/groups/merge-process`                          | Distinct UUID `source_group_uid`, `target_group_uid`; merge unique members and remove source |
| POST   | `/vendor-console/contacts/groups/assign-agent-process`                   | `group_uid`, `agent_uid`; assign eligible group contacts and transfer open handoffs          |

Groups expose `_id`, `_uid`, `title`, `description`, `status`, `wab_phone_number_id`, `created_at` and `updated_at`. Raw vendor/contact data and credentials are excluded. Titles are trimmed/nonempty and limited to 200 characters; descriptions are limited to 4,000. Duplicate titles remain allowed as in the source. Source edits clear an omitted description to null; native partial edits preserve omitted values. Source creates use status 1.

Listing supports `draw`, `start`, `length` (1-100), `search[value]`, `search[regex]=false`, one `order[0][column]` (2=title, 3=description, matching the source table) and `order[0][dir]`. Standard flat column descriptors are accepted; regex, per-column filtering, multiple sorts and unbounded export are rejected. Search covers title/description, sorts use an ID tie-breaker and counts stay within the selected active/archived workspace set.

The original browser session supplies a selected WhatsApp phone; native bearer sessions currently do not. Source creation therefore produces an unscoped group and source listing covers the whole selected workspace, not the original current-phone filter. Numeric/UUID reads still enforce workspace ownership. This is a material compatibility gap. Native resource writes retain explicit bounded `wabPhoneNumberId`, but that local field does not prove live provider ownership. Source null-status imports also still require reconciliation against the nonnullable native status model.

Catalog writes share a business lock and the existing per-group lock. They recheck current active user/business/membership, management/full-contact visibility and API-key permissions/expiry/revocation inside the transaction. Native resource-group POST/PATCH writes and native archive use the same lifecycle. Native input now permits only status 1/5 and bounded title/description/phone fields. Re-scoping populated or campaign-referenced groups is blocked.

Every bulk selection must be owned and available before any write occurs. Empty/duplicate/over-100 selections fail; foreign or missing targets fail the entire operation. This differs from source bulk operations that skip some unavailable targets. Imported cross-business contact links block edits, archive and deletion. Group deletion removes owned memberships without deleting contacts. Supported group references in campaign configurations block deletion; large/deeply nested imported configuration sets require review. This reference guard is not complete historical import reconciliation or provider verification.

Definition changes, membership cleanup and audits commit together. Audit failures roll back local writes. Successful bulk responses include `affectedGroups`, `removedMemberships` and source `reloadDatatableId`; these are JSON hints, not implemented Blade/realtime client effects. Unchanged status requests succeed with an audit instead of the source no-change reaction.

Original views, secured envelopes, cookies/CSRF, current-phone selection, permission aliases, subscription limits, demo restrictions, translations, original assignment provider/realtime integration remains pending. Local original/native assignment now shares the guarded transfer workflow; see [assignment behavior](LEGACY_CONTACT_ASSIGNMENT.md). Remote provider and realtime behavior remain unverified.

Tests: [group adapters](../tests/legacy-contact-groups.test.ts), [native contact workflows](../tests/contact-workflows.test.ts). Scoped evidence: [contact-groups-test-results.json](../migration/contact-groups-test-results.json).

Merge now has an original URL adapter. It requires owned active source/target groups with identical local phone scopes, moves only unique memberships, removes the source and writes an audit in one transaction. Source/target imported foreign links or a campaign reference to the source block the merge. Native merge enforces the same guards, closing a bypass of direct group deletion. The source-named response includes `movedContactsCount` and `reloadDatatableId`. Browser current-phone selection and original realtime/response behavior remain unverified.
