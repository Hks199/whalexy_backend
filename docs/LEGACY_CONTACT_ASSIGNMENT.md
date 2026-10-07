# Original group and chat assignment adapters

Two original Laravel JSON routes now have partial Node adapters:

| Method | Path                                                   | Request / response                                                                                           |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| POST   | `/vendor-console/contacts/groups/assign-agent-process` | UUID `group_uid`, `agent_uid`; HTTP 200 with `assignedContactsCount` and `reloadDatatableId`                 |
| POST   | `/vendor-console/whatsapp/contact/chat/assign-user`    | UUID `contactIdOrUid`, optional `assigned_users_uid`; HTTP 200 with `contactUid`, `currentlyAssignedUserUid` |

Both routes use native bearer authentication, active workspace membership and `vendor.chats.assign`. Multiple memberships require `X-Vendor-Id`. Group assignment additionally requires `vendor.groups.manage` and `vendor.chats.view_all`; single-chat assignment respects current assignment visibility unless the actor has full-contact visibility. These policies differ from original `manage_contacts`/`messaging` permission aliases and permissive role fallbacks.

The target must be an active user with active membership in the workspace and `vendor.chats.reply` or wildcard permission. Read-only members cannot receive assignments, even though older native code and some original role fallbacks permitted them. Original single-chat unassignment accepts missing/null/empty `assigned_users_uid` or `no_one`. The original group route requires an agent UUID; native group assignment retains `userId: null` for unassignment.

Native `/api/v1/vendors/:vendorId/contacts/:id/assign` and `/api/v1/vendors/:vendorId/groups/:id/assign` now share this service. Their HTTP response shapes remain 204 and `{ assignedContactsCount }` respectively. Native eligibility and inactive-contact handling are stricter than before.

The transaction locks the group when applicable, then contacts in numeric order, then the workspace handoff workflow. It rechecks current actor/vendor/membership/API-key permissions and current target eligibility after acquiring the locks. Contact assignments, open-handoff transfers and audits commit together. Audit failure rolls back all local writes. Ambiguous imported open handoffs reject the operation without partial contact assignment.

Waiting/accepted handoffs become waiting, receive the new assignee/assignment timestamp, and clear acceptance actor/time. They remain locally AI-paused, including unassignment. Existing handoff identifiers, reasons, severity and request timestamps remain intact. No handoff is created for an ordinary contact; its AI state is preserved. Closed handoff history is untouched. Repeating an assignment still resets an open acceptance as in the original transfer workflow.

Groups must be active. Imported cross-business memberships block assignment. The service captures at most 500 active contacts within the group's stored phone scope; inactive or differently scoped contacts are excluded. Larger groups fail before writing. Contacts removed/archived or moved to another phone before the final read are not assigned. This bounded local snapshot is not the source's session-selected phone behavior or an unbounded full-group contract.

The original `AiHandoffService::transfer` also attempts best-effort provider synchronization to `WAITING_FOR_AGENT`. This adapter implements local state and does not perform that provider call or invent acknowledgement. Original provider synchronization/recovery, realtime `contact-updated` broadcasts, client reload handling, cookies/CSRF/secured responses, translations, no-change messages, role aliases and live Laravel comparison remain pending. The JSON `reloadDatatableId` is only a source-named hint.

Tests: [assignment adapters](../tests/legacy-contact-assignment.test.ts), [contact workflows](../tests/contact-workflows.test.ts), [bot/handoff delivery](../tests/bot-replies.test.ts), [original conversation adapters](../tests/legacy-conversations.test.ts) and [provider-aware resolution](../tests/legacy-resolution.test.ts). Scoped evidence: [contact-assignment-test-results.json](../migration/contact-assignment-test-results.json).
