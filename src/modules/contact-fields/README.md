# contact-fields

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                    | Mounted prefix                                      |
| ------------------------- | --------------------------------------------------- |
| legacyContactFieldsRouter | `/vendor-console/contacts/custom-fields`            |
| contactFieldsRouter       | `/api/v1/vendors/:vendorId/custom-fields`           |
| contactFieldsRouter       | `/api/v1/vendors/:vendorId/resources/custom-fields` |

## Files to read

### Routes

- [contact-fields.routes.ts](contact-fields.routes.ts)
- [legacy-contact-fields.routes.ts](legacy-contact-fields.routes.ts)

### Controllers

- [contact-fields.controller.ts](contact-fields.controller.ts)
- [legacy-contact-fields.controller.ts](legacy-contact-fields.controller.ts)

### Validation

- [contact-fields.validation.ts](contact-fields.validation.ts)
- [legacy-contact-fields.validation.ts](legacy-contact-fields.validation.ts)

### Middleware

- [contact-fields.middleware.ts](contact-fields.middleware.ts)

### Services and domain helpers

- [contact-fields.service.ts](contact-fields.service.ts)
- [services/legacy-contact-fields.service.ts](services/legacy-contact-fields.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                    | Method | Relative path                                 | Controller         |
| ------------------------- | ------ | --------------------------------------------- | ------------------ |
| contactFieldsRouter       | GET    | `/`                                           | listContactFields  |
| contactFieldsRouter       | GET    | `/:id`                                        | getContactField    |
| contactFieldsRouter       | POST   | `/`                                           | createContactField |
| contactFieldsRouter       | PATCH  | `/:id`                                        | updateContactField |
| contactFieldsRouter       | DELETE | `/:id`                                        | deleteContactField |
| legacyContactFieldsRouter | GET    | `/list-data`                                  | list               |
| legacyContactFieldsRouter | POST   | `/add-process`                                | create             |
| legacyContactFieldsRouter | POST   | `/update-process`                             | update             |
| legacyContactFieldsRouter | GET    | `/:contactCustomFieldIdOrUid/get-update-data` | show               |
| legacyContactFieldsRouter | POST   | `/:contactCustomFieldIdOrUid/delete-process`  | remove             |

## Behavior tests

- [contact-fields.test.ts](../../../tests/contact-fields.test.ts)
- [legacy-contact-fields.test.ts](../../../tests/legacy-contact-fields.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
