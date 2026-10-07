# appointments

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                      | Mounted prefix                           |
| --------------------------- | ---------------------------------------- |
| legacyAppointmentRouter     | `/api/:vendorUid/appointments`           |
| appointmentManagementRouter | `/api/v1/vendors/:vendorId/appointments` |
| appointmentsRouter          | `/api/v1/vendors/:vendorId/appointments` |

## Files to read

### Routes

- [appointment-management.routes.ts](appointment-management.routes.ts)
- [appointments.routes.ts](appointments.routes.ts)
- [legacy-appointment.routes.ts](legacy-appointment.routes.ts)

### Controllers

- [appointment-management.controller.ts](appointment-management.controller.ts)
- [appointments.controller.ts](appointments.controller.ts)
- [legacy-appointment.controller.ts](legacy-appointment.controller.ts)

### Validation

- [appointment-management.validation.ts](appointment-management.validation.ts)
- [appointments.validation.ts](appointments.validation.ts)
- [legacy-appointment.validation.ts](legacy-appointment.validation.ts)

### Middleware

- [appointments.middleware.ts](appointments.middleware.ts)
- [legacy-appointment.middleware.ts](legacy-appointment.middleware.ts)

### Services and domain helpers

- [services/appointment-availability.service.ts](services/appointment-availability.service.ts)
- [services/appointment-bookings.service.ts](services/appointment-bookings.service.ts)
- [services/appointment-management.service.ts](services/appointment-management.service.ts)
- [services/appointments-support.service.ts](services/appointments-support.service.ts)
- [services/legacy-appointment-bookings.service.ts](services/legacy-appointment-bookings.service.ts)
- [services/legacy-appointment.service.ts](services/legacy-appointment.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                      | Method | Relative path                      | Controller                       |
| --------------------------- | ------ | ---------------------------------- | -------------------------------- |
| appointmentManagementRouter | GET    | `/resources`                       | listResources                    |
| appointmentManagementRouter | POST   | `/resources`                       | createResource                   |
| appointmentManagementRouter | PUT    | `/resources/:resourceUid`          | updateResource                   |
| appointmentManagementRouter | DELETE | `/resources/:resourceUid`          | deleteResource                   |
| appointmentManagementRouter | GET    | `/resources/:resourceUid/schedule` | getResourceSchedule              |
| appointmentManagementRouter | PUT    | `/resources/:resourceUid/schedule` | replaceResourceSchedule          |
| appointmentManagementRouter | GET    | `/services`                        | listServices                     |
| appointmentManagementRouter | POST   | `/services`                        | createService                    |
| appointmentManagementRouter | PUT    | `/services/:serviceUid`            | updateService                    |
| appointmentManagementRouter | DELETE | `/services/:serviceUid`            | deleteAppointmentService         |
| appointmentManagementRouter | GET    | `/off-duty`                        | listOffDuty                      |
| appointmentManagementRouter | POST   | `/off-duty`                        | createOffDuty                    |
| appointmentManagementRouter | DELETE | `/off-duty/:exceptionId`           | deleteOffDuty                    |
| appointmentsRouter          | GET    | `/availability`                    | getAppointmentAvailability       |
| appointmentsRouter          | POST   | `/service-resources`               | createAppointmentResource        |
| appointmentsRouter          | POST   | `/holds`                           | holdAppointmentSlot              |
| appointmentsRouter          | POST   | `/`                                | bookAppointment                  |
| appointmentsRouter          | GET    | `/:id`                             | getAppointment                   |
| appointmentsRouter          | POST   | `/:id/cancel`                      | cancelAppointment                |
| appointmentsRouter          | POST   | `/:id/reschedule`                  | rescheduleAppointment            |
| appointmentsRouter          | POST   | `/:id/no-show`                     | markAppointmentNoShow            |
| legacyAppointmentRouter     | GET    | `/services`                        | listLegacyAppointmentServices    |
| legacyAppointmentRouter     | POST   | `/services`                        | createLegacyAppointmentService   |
| legacyAppointmentRouter     | GET    | `/resources`                       | listLegacyAppointmentResources   |
| legacyAppointmentRouter     | POST   | `/resources`                       | createLegacyAppointmentResource  |
| legacyAppointmentRouter     | PUT    | `/resources/:resourceUid/schedule` | replaceLegacyAppointmentSchedule |
| legacyAppointmentRouter     | GET    | `/availability`                    | getLegacyAppointmentAvailability |
| legacyAppointmentRouter     | POST   | `/holds`                           | holdLegacyAppointmentSlot        |
| legacyAppointmentRouter     | POST   | `/`                                | bookLegacyAppointment            |
| legacyAppointmentRouter     | GET    | `/:appointmentUid`                 | getLegacyAppointment             |
| legacyAppointmentRouter     | POST   | `/:appointmentUid/cancel`          | cancelLegacyAppointment          |

## Behavior tests

- [appointment-management.test.ts](../../../tests/appointment-management.test.ts)
- [appointment-reminders.test.ts](../../../tests/appointment-reminders.test.ts)
- [appointment-workflows.test.ts](../../../tests/appointment-workflows.test.ts)
- [legacy-appointment-bookings.test.ts](../../../tests/legacy-appointment-bookings.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
