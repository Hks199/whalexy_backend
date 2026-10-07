# Appointment management APIs

Appointment setup is available through named routes, controllers, validation and services in [the appointment feature](../src/modules/appointments/README.md). It no longer requires writing configuration records directly into PostgreSQL.

All native URLs below start with `/api/v1/vendors/:vendorId/appointments`. They require a native bearer session or scoped API key, an active business membership, and `vendor.appointments.view` for reads or `vendor.appointments.manage` for writes.

| Method       | Path                               | Operation                                 |
| ------------ | ---------------------------------- | ----------------------------------------- |
| GET / POST   | `/resources`                       | List / create resources                   |
| PUT / DELETE | `/resources/:resourceUid`          | Update / delete a resource                |
| GET / PUT    | `/resources/:resourceUid/schedule` | Read / replace working periods            |
| GET / POST   | `/services`                        | List / create services and resource links |
| PUT / DELETE | `/services/:serviceUid`            | Update / delete a service                 |
| GET / POST   | `/off-duty`                        | List / create off-duty periods            |
| DELETE       | `/off-duty/:exceptionId`           | Delete an off-duty period                 |

Resources use UUIDs in management URLs; bookings retain their existing numeric IDs. A service takes `resourceUids`, `name`, `durationMinutes`, `timezone`, optional description, buffers, price and currency. Resource creation takes `name`, `timezone`, optional `userId`, `type`, `metadata` and `autoAssignChat`. Updating a resource or service also requires `status` (`active` or `inactive`). Staff must have an active native membership and active user account in the same business.

Schedule replacement accepts `{ "periods": [{ "weekday": 1, "startLocalTime": "09:00", "endLocalTime": "17:00", "timezone": "UTC" }] }`. Weekdays are 1–7. Periods must end after they begin; an empty array clears working periods. Validation completes before deleting the previous schedule. Booking repeats schedule/conflict checks under its resource lock.

Off-duty creation accepts `startsAt`, `endsAt`, optional `reason` and `resourceId`. Omitting `resourceId` applies the period to the whole business, represented by resource ID 0 as in the source. Existing appointments are preserved; blocking periods affect subsequent booking checks.

Deleting resources/services with upcoming confirmed bookings or unexpired holds returns 409. Dependent links and schedules are removed in the same transaction. Historical appointments are preserved. Resource/service mutations and link creation share the booking lock order. Generic resource writes for appointment services/resources/schedules/exceptions now return 403, so they cannot bypass these workflows; generic reads remain available.

## Original appointment API URL adapters

All ten original appointment API URLs have adapters mounted at `/api/:vendorUid/appointments`:

| Method     | Path                               |
| ---------- | ---------------------------------- |
| GET / POST | `/services`                        |
| GET / POST | `/resources`                       |
| PUT        | `/resources/:resourceUid/schedule` |
| GET        | `/availability`                    |
| POST       | `/holds`                           |
| POST       | `/`                                |
| GET        | `/:appointmentUid`                 |
| POST       | `/:appointmentUid/cancel`          |

They accept source field names (`resource_uids`, `duration_minutes`, buffer fields, `users__id`, `auto_assign_chat`, `start_local_time`, `end_local_time`) and return source record names such as `_id`, `_uid`, `vendors__id`, `users__id` and `created_at` inside `{ "data": ... }`. Prices use the source two-decimal string representation. Schedule replacement returns `{ "result": "success" }`. Invalid request bodies return 422.

Availability accepts `service_uid`, optional `resource_uid`, `date` and optional `timezone`. It returns source-shaped slots across linked active resources, bounded to 100 resources unless one is selected. Holds/bookings accept `service_uid`, `resource_uid`, `starts_at`, `timezone` and optional `contact_id`. Booking also accepts source customer fields, notes, source, hold token and idempotency key. Local ISO timestamps are interpreted in the supplied timezone. Holds expose the original token/expiry fields; bookings expose source record names. Viewing/cancellation use appointment UUIDs and cancellation returns the updated record with HTTP 200. Slot conflicts use the source `slot_unavailable` envelope.

Contact-free holds/bookings require `vendor.chats.view_all` in addition to the management permission. Customer phone/email fields are masked for readers without `vendor.contacts.view_phone`. Native booking also supports optional contact IDs and customer metadata. Replays check the booking and customer payload; changed requests conflict. Contact-free bookings do not assign unrelated contacts to the resource's staff member.

These adapters require **native credentials**. Laravel plaintext business tokens, query-string credentials, browser cookies and sessions are not converted or activated. Original Blade/redirect contracts, credential compatibility, response timestamp formatting, strict native idempotency/privacy policies, capacity pools and live provider behavior still need review. The ten adapters are recorded as partial implementations, not verified legacy contracts.

[HTTP tests](../tests/appointment-management.test.ts) exercise native management, original URL/field adapters, permissions, cross-business denial, failed replacement preservation, deletion guards and generic-write denial. Existing appointment workflow and reminder tests cover booking conflicts, claims and delivery behavior.
