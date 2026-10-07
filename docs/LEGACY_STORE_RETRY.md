# Original store notification retry APIs

Two source URLs have partial Node adapters:

- POST `/vendor-console/integration/shopify/notifications/:notificationId/resend`
- POST `/vendor-console/integration/woocommerce/notifications/:notificationId/resend`

Use native bearer/workspace authentication, both `vendor.integrations.manage` and `vendor.chats.reply`, an empty JSON body and an `Idempotency-Key` of 8?100 letters, digits, underscores or hyphens. The notification ID is a positive integer. HTTP 202 returns `{success: true, message: "Notification queued for retry", status: "pending", notification_id, job_id}`. This acknowledges queueing; provider delivery is asynchronous.

The service rechecks current identity/permissions, owned order/contact/store/sender, contact assignment visibility and active base subscription. Only failed or blocked notifications with no delivery IDs or sent/delivered/read timestamps qualify. Exactly one native WhatsApp delivery job must exist and establish a known unsent failure. Uncertain, interrupted, unknown, pending or processing jobs fail with HTTP 409. Imported notifications without reconciled native jobs cannot be retried. WooCommerce retains the source cap of three retries.

The original order snapshot, store settings and template revision must still match the job. The approved template, active store, recipient/sender and marketing opt-out are revalidated. Invalid native references and changed configuration require reconciliation. These guards prevent silently retrying a stale order or sending to another recipient.

A serializable transaction requeues the existing job and message, updates the notification, writes the audit and stores the idempotent response. It preserves delivery history, installs the current sending actor and removes stale API-key provenance. The worker checks delivery eligibility again. A failed audit rolls back all retry changes. Repeating the same key and target returns the original queued response; reusing the key for another target fails.

Laravel's synchronous resend/reset behavior is not duplicated: delivery history is retained and unsafe or unreconciled sends are refused. Original sessions, frontend refreshes, translations/error envelopes, demo/full billing policies, imported job reconciliation and live provider/source comparisons remain pending. These adapters are not fully compatibility-verified.

Tests: [retry behavior and rollback](../tests/legacy-store-retry.test.ts).
