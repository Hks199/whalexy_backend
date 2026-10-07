# appointment-reminders

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                      | Mounted prefix                                      |
| --------------------------- | --------------------------------------------------- |
| appointmentAutomationRouter | `/api/v1/vendors/:vendorId/appointments/automation` |

## Files to read

### Routes

- [appointment-reminders.routes.ts](appointment-reminders.routes.ts)

### Controllers

- [appointment-reminders.controller.ts](appointment-reminders.controller.ts)

### Validation

- [appointment-reminders.validation.ts](appointment-reminders.validation.ts)

### Types and constants

- [appointment-reminders.constants.ts](appointment-reminders.constants.ts)

### Services and domain helpers

- [appointment-reminders.service.ts](appointment-reminders.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                      | Method | Relative path | Controller             |
| --------------------------- | ------ | ------------- | ---------------------- |
| appointmentAutomationRouter | GET    | `/`           | getReminderSettings    |
| appointmentAutomationRouter | PUT    | `/`           | updateReminderSettings |

## Behavior tests

- [appointment-reminders.test.ts](../../../tests/appointment-reminders.test.ts)
- [bot-replies.test.ts](../../../tests/bot-replies.test.ts)
- [contact-automation.test.ts](../../../tests/contact-automation.test.ts)
- [legacy-resolution.test.ts](../../../tests/legacy-resolution.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
