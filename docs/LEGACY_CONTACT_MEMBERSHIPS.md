# Original contact group membership APIs

Two original Laravel JSON declarations have partial Node adapters:

| Method | Path                                                                | Input                                                                    |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/vendor-console/contacts/assign-groups-selected-process`           | `selected_contacts`: contact UUIDs; `selected_groups`: numeric group IDs |
| POST   | `/vendor-console/contacts/:contactIdOrUid/:groupUid/remove-process` | Numeric ID or UUID contact; UUID group; empty body                       |

Assignment adds every selected group to every selected contact, preserves unrelated memberships and skips existing links. HTTP 200 returns `affectedMemberships`, `reloadDatatableId: '#lwContactList'` and `modalId: '#lwAssignGroups'`. Repeated assignment returns zero affected memberships and `No changes`. Removal deletes only the selected link, preserves the contact and other memberships, and returns the affected count. Missing links return a successful no-change result; Laravel instead reports removal failure.

Native contact group POST/DELETE endpoints share the same service and retain HTTP 204. Native additions now reject inactive contacts/groups and use atomic audits. Both operations require current active workspace/actor/membership/API-key access, `vendor.contacts.edit` and `vendor.groups.manage`; assigned-contact visibility applies. Bulk assignment additionally requires `vendor.chats.view_all`. Bearer authentication and explicit workspace selection replace original session/`manage_contacts` permissions. These are intentional stricter policies.

Inputs require unique, nonempty selections of at most 100 contacts and 50 groups. Every selected record must belong to the workspace and be visible. Mixed missing/foreign selections reject the entire operation instead of silently skipping rows. Addition requires active records and compatible stored phone scopes. Archived or inactive records can have existing memberships removed. Any imported foreign contact linked to a selected group blocks mutation pending reconciliation.

The service locks groups in numeric order, then contacts in numeric order, rechecks current authorization and selected records, and commits links with an audit in one transaction. Audit failure rolls back local writes. Concurrent native/original additions share locks and the membership unique constraint. No contacts, messages, assignments, handoffs or unrelated group links are changed. These locks coordinate the converted workflows; they do not guarantee compatibility with every remaining legacy/import writer.

Original cookie/CSRF/secured envelopes, translations, browser-selected phone scope, role aliases, client reload/modal handling and live Laravel/frontend comparison remain unverified. The source assignment engine resolves group numeric IDs and contact UUIDs without explicit tenant restrictions at those fetches; this implementation deliberately enforces ownership. A response hint does not implement the original frontend behavior.

Validation: [membership tests](../tests/legacy-contact-memberships.test.ts), [native workflows](../tests/contact-workflows.test.ts), [group lifecycle](../tests/legacy-contact-groups.test.ts), [assignment workflows](../tests/legacy-contact-assignment.test.ts). Evidence: [contact-memberships-test-results.json](../migration/contact-memberships-test-results.json).
