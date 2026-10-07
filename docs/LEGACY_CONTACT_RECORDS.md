# Original contact edit-data and deletion APIs

| Method | Original path                                              | Node behavior                                                             |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/vendor-console/contacts/:contactIdOrUid/get-update-data` | Numeric/UUID contact, source-named safe edit-data projection              |
| POST   | `/vendor-console/contacts/:contactIdOrUid/delete-process`  | Numeric/UUID contact, empty body, guarded deletion, HTTP 200 success JSON |

These are partial original URL/field adapters. They require native bearer authentication and active workspace membership; multiple memberships require `X-Vendor-Id`. Read requires `vendor.contacts.view`; deletion requires `vendor.contacts.delete`. Contact visibility applies to both, and permission to view phone details is checked separately. Source `manage_contacts`, cookies/CSRF, secured envelopes, translations, frontend events and live Laravel comparison remain unverified.

Edit data uses a repeatable-read transaction with current actor/vendor/membership/API-key authorization. It returns `_id`, `_uid`, source-named contact fields, owned `groups`, `custom_field_values`, safe country metadata and JSON-string `existingGroupIds`. Phone is masked and email omitted as null without `vendor.contacts.view_phone`. Raw `__data`, referral/private metadata and foreign imported group/custom-field links are excluded. More than 500 owned groups or custom values rejects the profile rather than silently truncating an edit selection. The response intentionally excludes several fields from the source's full Eloquent model serialization.

Deletion delegates to native contact deletion and retains its HTTP 204 for native callers. It locks the contact, rechecks current deletion/visibility permissions, protects campaign test recipients and future bookings, rejects processing sends, cancels queued effects, cleans supported restrictive links and writes the audit atomically. A failure rolls back cleanup and cancellation. Other retained foreign-key references, including handoff history, return HTTP 409 `CONTACT_REFERENCES_PENDING` and require reconciliation; the adapter does not erase retained history or report success when deletion fails. Audit failure remains an internal error with rollback. Unknown/foreign contacts return 404.

Deletion now explicitly blocks contacts with handoffs, AI analyses, classification records/logs or CX scores, even where the database would cascade those records. Native deletion shares this stricter history policy. Reconciling or removing retained history requires a separate reviewed workflow.

Original contact creation/update now has [partial form adapters](LEGACY_CONTACT_WRITE.md), and [bulk deletion](LEGACY_CONTACT_BULK_DELETE.md) has bounded atomic adapters. Source plan limits, browser phone selection and full frontend compatibility remain pending.

Tests: [original record adapters](../tests/legacy-contact-records.test.ts), [native lifecycle](../tests/contact-lifecycle.test.ts), [contact workflows](../tests/contact-workflows.test.ts), [original profile](../tests/legacy-contact-profile.test.ts), [membership adapters](../tests/legacy-contact-memberships.test.ts). Evidence: [contact-records-test-results.json](../migration/contact-records-test-results.json).
