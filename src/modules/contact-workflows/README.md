# contact-workflows

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                         | Mounted prefix                       |
| ------------------------------ | ------------------------------------ |
| legacyContactGroupsRouter      | `/vendor-console/contacts/groups`    |
| legacyContactMembershipsRouter | `/vendor-console/contacts`           |
| legacyContactRecordsRouter     | `/vendor-console/contacts`           |
| legacyContactDirectoryRouter   | `/vendor-console/contacts`           |
| legacyContactBulkDeleteRouter  | `/vendor-console/contacts`           |
| legacyContactProfileRouter     | `/vendor-console/whatsapp/contact`   |
| contactWorkflowsRouter         | `/api/v1/vendors/:vendorId/contacts` |
| groupsRouter                   | `/api/v1/vendors/:vendorId/groups`   |

## Files to read

### Routes

- [contact-workflows.routes.ts](contact-workflows.routes.ts)
- [legacy-contact-bulk-delete.routes.ts](legacy-contact-bulk-delete.routes.ts)
- [legacy-contact-directory.routes.ts](legacy-contact-directory.routes.ts)
- [legacy-contact-groups.routes.ts](legacy-contact-groups.routes.ts)
- [legacy-contact-memberships.routes.ts](legacy-contact-memberships.routes.ts)
- [legacy-contact-profile.routes.ts](legacy-contact-profile.routes.ts)
- [legacy-contact-records.routes.ts](legacy-contact-records.routes.ts)

### Controllers

- [contact-workflows.controller.ts](contact-workflows.controller.ts)
- [legacy-contact-bulk-delete.controller.ts](legacy-contact-bulk-delete.controller.ts)
- [legacy-contact-directory.controller.ts](legacy-contact-directory.controller.ts)
- [legacy-contact-groups.controller.ts](legacy-contact-groups.controller.ts)
- [legacy-contact-memberships.controller.ts](legacy-contact-memberships.controller.ts)
- [legacy-contact-profile.controller.ts](legacy-contact-profile.controller.ts)
- [legacy-contact-records.controller.ts](legacy-contact-records.controller.ts)

### Validation

- [contact-groups.validation.ts](contact-groups.validation.ts)
- [contact-labels.validation.ts](contact-labels.validation.ts)
- [contact-workflows.validation.ts](contact-workflows.validation.ts)
- [legacy-contact-bulk-delete.validation.ts](legacy-contact-bulk-delete.validation.ts)
- [legacy-contact-directory.validation.ts](legacy-contact-directory.validation.ts)
- [legacy-contact-memberships.validation.ts](legacy-contact-memberships.validation.ts)
- [legacy-contact-profile.validation.ts](legacy-contact-profile.validation.ts)
- [legacy-contact-records.validation.ts](legacy-contact-records.validation.ts)

### Middleware

- [contact-workflows.middleware.ts](contact-workflows.middleware.ts)

### Services and domain helpers

- [services/contact-administration.service.ts](services/contact-administration.service.ts)
- [services/contact-assignment.service.ts](services/contact-assignment.service.ts)
- [services/contact-export.service.ts](services/contact-export.service.ts)
- [services/contact-group-membership.service.ts](services/contact-group-membership.service.ts)
- [services/contact-groups.service.ts](services/contact-groups.service.ts)
- [services/contact-import.service.ts](services/contact-import.service.ts)
- [services/contact-labels.service.ts](services/contact-labels.service.ts)
- [services/contact-lifecycle.service.ts](services/contact-lifecycle.service.ts)
- [services/contact-profile.service.ts](services/contact-profile.service.ts)
- [services/contact-workflows-support.service.ts](services/contact-workflows-support.service.ts)
- [services/legacy-contact-bulk-delete.service.ts](services/legacy-contact-bulk-delete.service.ts)
- [services/legacy-contact-directory.service.ts](services/legacy-contact-directory.service.ts)
- [services/legacy-contact-groups.service.ts](services/legacy-contact-groups.service.ts)
- [services/legacy-contact-memberships.service.ts](services/legacy-contact-memberships.service.ts)
- [services/legacy-contact-profile.service.ts](services/legacy-contact-profile.service.ts)
- [services/legacy-contact-records.service.ts](services/legacy-contact-records.service.ts)
- [services/legacy-contact-write.service.ts](services/legacy-contact-write.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                         | Method | Relative path                                              | Controller                |
| ------------------------------ | ------ | ---------------------------------------------------------- | ------------------------- |
| contactWorkflowsRouter         | GET    | `/:id/notes`                                               | getContactNotes           |
| contactWorkflowsRouter         | PUT    | `/:id/notes`                                               | updateContactNotes        |
| contactWorkflowsRouter         | DELETE | `/:id`                                                     | deleteContact             |
| contactWorkflowsRouter         | GET    | `/:id/labels`                                              | getContactLabels          |
| contactWorkflowsRouter         | PUT    | `/:id/labels`                                              | updateContactLabels       |
| contactWorkflowsRouter         | GET    | `/:id/custom-values`                                       | getContactCustomValues    |
| contactWorkflowsRouter         | PUT    | `/:id/custom-values`                                       | updateContactCustomValues |
| contactWorkflowsRouter         | DELETE | `/:id/groups/:groupId`                                     | removeContactFromGroup    |
| groupsRouter                   | POST   | `/:id/assign`                                              | assignContact             |
| groupsRouter                   | POST   | `/:id/merge`                                               | mergeContacts             |
| groupsRouter                   | POST   | `/:id/archive`                                             | archiveContact            |
| contactWorkflowsRouter         | POST   | `/import`                                                  | importContacts            |
| contactWorkflowsRouter         | GET    | `/export`                                                  | exportContacts            |
| legacyContactBulkDeleteRouter  | POST   | `/delete-selected-process`                                 | selected                  |
| legacyContactBulkDeleteRouter  | POST   | `['/delete-all-process', '/delete-all-process/:groupUid']` | filtered                  |
| legacyContactDirectoryRouter   | GET    | `['/list-data', '/list-data/:groupUid']`                   | list                      |
| legacyContactGroupsRouter      | GET    | `['/list-data', '/:status/list-data']`                     | list                      |
| legacyContactGroupsRouter      | POST   | `/add-process`                                             | create                    |
| legacyContactGroupsRouter      | POST   | `/update-process`                                          | update                    |
| legacyContactGroupsRouter      | POST   | `/delete-selected-process`                                 | removeSelected            |
| legacyContactGroupsRouter      | POST   | `/archive-selected-process`                                | archiveSelected           |
| legacyContactGroupsRouter      | POST   | `/unarchive-selected-process`                              | unarchiveSelected         |
| legacyContactGroupsRouter      | GET    | `/:contactGroupIdOrUid/get-update-data`                    | show                      |
| legacyContactGroupsRouter      | POST   | `/:contactGroupIdOrUid/delete-process`                     | remove                    |
| legacyContactGroupsRouter      | POST   | `/:contactGroupIdOrUid/archive-process`                    | archive                   |
| legacyContactGroupsRouter      | POST   | `/:contactGroupIdOrUid/unarchive-process`                  | unarchive                 |
| legacyContactGroupsRouter      | POST   | `/merge-process`                                           | merge                     |
| legacyContactGroupsRouter      | POST   | `/assign-agent-process`                                    | assignAgent               |
| legacyContactMembershipsRouter | POST   | `/assign-groups-selected-process`                          | assignGroups              |
| legacyContactMembershipsRouter | POST   | `/:contactIdOrUid/:groupUid/remove-process`                | removeGroup               |
| legacyContactProfileRouter     | POST   | `/chat/update-notes`                                       | notes                     |
| legacyContactProfileRouter     | POST   | `/chat/assign-labels`                                      | assignLabels              |
| legacyContactProfileRouter     | GET    | `/labels/:contactUid`                                      | labels                    |
| legacyContactProfileRouter     | POST   | `/create-label`                                            | createLabel               |
| legacyContactProfileRouter     | POST   | `/chat/edit-label`                                         | editLabel                 |
| legacyContactProfileRouter     | POST   | `/chat/delete-label/:labelUid`                             | removeLabel               |
| legacyContactProfileRouter     | POST   | `/chat/assign-user`                                        | assignChat                |
| legacyContactRecordsRouter     | POST   | `/add-process`                                             | create                    |
| legacyContactRecordsRouter     | POST   | `/update-process`                                          | update                    |
| legacyContactRecordsRouter     | GET    | `/:contactIdOrUid/get-update-data`                         | editData                  |
| legacyContactRecordsRouter     | POST   | `/:contactIdOrUid/delete-process`                          | remove                    |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [campaign-workflows.test.ts](../../../tests/campaign-workflows.test.ts)
- [classifications-cx.test.ts](../../../tests/classifications-cx.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [contact-data.test.ts](../../../tests/contact-data.test.ts)
- [contact-fields.test.ts](../../../tests/contact-fields.test.ts)
- [contact-lifecycle.test.ts](../../../tests/contact-lifecycle.test.ts)
- [contact-workflows.test.ts](../../../tests/contact-workflows.test.ts)
- [integration.test.ts](../../../tests/integration.test.ts)
- [legacy-chat-message.test.ts](../../../tests/legacy-chat-message.test.ts)
- [legacy-chat-read.test.ts](../../../tests/legacy-chat-read.test.ts)
- [legacy-classifications-cx.test.ts](../../../tests/legacy-classifications-cx.test.ts)
- [legacy-contact-assignment.test.ts](../../../tests/legacy-contact-assignment.test.ts)
- [legacy-contact-bulk-delete.test.ts](../../../tests/legacy-contact-bulk-delete.test.ts)
- [legacy-contact-directory.test.ts](../../../tests/legacy-contact-directory.test.ts)
- [legacy-contact-fields.test.ts](../../../tests/legacy-contact-fields.test.ts)
- [legacy-contact-groups.test.ts](../../../tests/legacy-contact-groups.test.ts)
- [legacy-contact-memberships.test.ts](../../../tests/legacy-contact-memberships.test.ts)
- [legacy-contact-profile.test.ts](../../../tests/legacy-contact-profile.test.ts)
- [legacy-contact-records.test.ts](../../../tests/legacy-contact-records.test.ts)
- [legacy-contact-write.test.ts](../../../tests/legacy-contact-write.test.ts)
- [legacy-contacts.test.ts](../../../tests/legacy-contacts.test.ts)
- [legacy-conversations.test.ts](../../../tests/legacy-conversations.test.ts)
- [legacy-label-management.test.ts](../../../tests/legacy-label-management.test.ts)
- [legacy-messaging.test.ts](../../../tests/legacy-messaging.test.ts)
- [legacy-mobile.test.ts](../../../tests/legacy-mobile.test.ts)
- [legacy-store-history.test.ts](../../../tests/legacy-store-history.test.ts)
- [quoted-replies.test.ts](../../../tests/quoted-replies.test.ts)
- [security.test.ts](../../../tests/security.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
