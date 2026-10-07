# Original bulk contact deletion

| Method | Path                                                    | Request                                                     |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------- |
| POST   | `/vendor-console/contacts/delete-selected-process`      | Unique nonempty `selected_contacts` UUID array, maximum 100 |
| POST   | `/vendor-console/contacts/delete-all-process`           | Optional `search`, `platform`, `from_phone_number_id`       |
| POST   | `/vendor-console/contacts/delete-all-process/:groupUid` | Same body, owned group UUID                                 |

These three Node patterns adapt two Laravel declarations, one with an optional group. Native bearer/workspace authentication and `vendor.contacts.delete` apply. Selected deletion respects current assigned visibility and rejects the entire selection if any contact is missing, foreign or hidden. Filtered deletion additionally requires full contact visibility. Response HTTP 200 includes `deletedContactsCount` and `reloadDatatableId: '#lwContactList'`; zero matches are a successful no-change result.

Filtered deletion captures a bounded matching snapshot inside a serializable transaction. More than 100 matches fails before writing; it never silently deletes only the first page. The service locks an optional group, selected contacts in numeric order, then the workspace handoff workflow. Every contact uses the same deletion helper as native/original single deletion. Supported link cleanup, queued-effect cancellation and per-contact audits commit together. A protected later member, processing send, retained reference or audit failure rolls back all earlier writes. Serialization/deadlock failures retry at most twice because all effects are local transaction writes.

Campaign test recipients, future bookings, processing WhatsApp sends, retained handoff/AI-analysis/classification/CX history and other restrictive references block the whole batch. Laravel instead skips campaign test recipients and deletes remaining selections. Native single deletion retains its HTTP 204 and the same safeguards. There is no partial-success mode and no remote provider deletion effect.

`platform` defaults to WhatsApp, including stored null/empty values. Facebook includes Messenger; Instagram is separate. Search covers names plus phone/email/social identifiers only with phone visibility; hidden fields cannot select deletion targets. Country-ID matching and other source search differences remain unverified. An explicit sender must be connected to the workspace. It constrains only the general WhatsApp selection; group filters retain actual owned membership across sender numbers. Empty groups delete nothing; unknown/foreign groups return 404 instead of falling back to all contacts. Source browser/session phone selection is not implemented.

These remain partial adapters: source demo/subscription rules, unbounded large batches, skipped-test-recipient/no-change semantics, cookies/CSRF/secured envelopes, permission aliases, translations, frontend reload behavior, complete background-effect reconciliation and live Laravel comparison are pending. A concurrent contact created after the matching snapshot is not promised deletion. The `delete-all` source name does not remove the 100-contact bound.

Tests: [bulk deletion](../tests/legacy-contact-bulk-delete.test.ts), [native deletion](../tests/contact-lifecycle.test.ts), [original records](../tests/legacy-contact-records.test.ts), [membership](../tests/legacy-contact-memberships.test.ts), [directory](../tests/legacy-contact-directory.test.ts). Evidence: [contact-bulk-delete-test-results.json](../migration/contact-bulk-delete-test-results.json).
