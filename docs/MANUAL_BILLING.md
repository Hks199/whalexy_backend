# Manual payment workflows

Manual payments use native Node contracts. Bank/UPI payment evidence is submitted for central review; submitting a reference or uploading a receipt never activates a subscription. Automated bank verification, PayPal/Razorpay subscription settlement, refunds, plan limits, complete tax invoices and original frontend contracts remain unfinished.

Enable manual payments explicitly on selected `BILLING_PLANS` entries with `manualPayments: true`. Existing plans default to false. Amounts are integer currency minor units and are selected by the server. A Stripe secret is not needed for manual payment preparation. The existing `priceId` configuration field is still required by the shared plan schema.

```json
{
  "id": "pro_monthly",
  "title": "Pro monthly",
  "priceId": "price_configured_plan",
  "interval": "monthly",
  "amount": 120000,
  "currency": "INR",
  "manualPayments": true
}
```

All vendor manual routes require owner access, business membership and `administrative` permission. API keys are rejected. Prefix: `/api/v1/vendors/:vendorId/billing`.

| Method/path | Input / result |
|---|---|
| `GET /manual` | Paginated request history using `page` and `limit` |
| `POST /manual/quote` | `{planId,paymentMethod}` and `Idempotency-Key`; methods: `bank_transfer`, `upi`; returns a 15-minute server quote |
| `GET /manual/:id` | Current owned request status/details |
| `POST /manual/:id/submit` | `{transactionReference,receiptId}`; requires the caller's image/PDF uploaded in this business; transitions to pending |
| `POST /manual/:id/cancel` | `{}`; cancels only initiated/pending requests |
| `GET /manual/:id/invoice` | Immutable approved native payment invoice JSON |
| `GET /manual/:id/invoice.pdf` | Downloadable PDF payment invoice |

Quote keys replay the original snapshot. Read the request detail endpoint for current status, including cancellation/expiry. A fresh quote cancels earlier initiated quotes; a pending payment must be reviewed or cancelled first. Identical submissions replay pending status. Used payment references remain reserved after rejection/cancellation so that the same transfer cannot be submitted repeatedly. References are reserved across businesses within each manual payment method. Receipt MIME types are restricted to PDF/PNG/JPEG/WebP. Customer-uploaded evidence is reviewed by the administrator against the payment received.

Calendar periods are calculated in UTC with month-end/leap-year clamping. Supported intervals are monthly, half-yearly and yearly. Amounts are converted using configured currency precision and exact decimal arithmetic. Approval starts the new period at review time. Only native approved subscriptions with a verified same-currency price and period can carry forward remaining value. Remaining monetary value is converted into whole extra days; approval recalculates it after review delays. Ambiguous legacy/multiple-active/cross-currency balances are blocked for reconciliation. A different active plan appearing after quote creation also blocks approval.

Manual requests and new Stripe checkout claims share a business lock. Active manual plans or unreviewed manual requests block new checkout. Existing provider subscriptions and uncertain/open checkouts block manual preparation. Provider-confirmed expired checkout state can release the conflict. An expired manual quote must be cancelled or replaced before switching payment methods. These guards cover tracked native requests; external provider changes and full legacy billing equivalence still require review.

Central role-1 administrators use the existing `/api/v1/admin/vendors/:vendorId/billing/manual/:id/approve` and `/reject` endpoints. For native requests, approval body is `{}`: expiry comes from the quote and cannot be supplied by the caller. Legacy review still requires explicit `endsAt`. Rejection requires `{reason}`. Native approval atomically supersedes prior active manual plans, records the reviewer, activates the new plan and stores its invoice snapshot. Repeated or competing reviews fail after the first transition.

`GET /api/v1/admin/vendors/:vendorId/billing/manual/:id/receipt` allows central role-1 reviewers to download the private uploaded receipt. Tenant ownership and private storage path are checked; missing files return a safe 404. Business wildcard permissions do not grant central review access.

Invoice snapshots retain the approved business name, price, currency, period, carry-forward amount/days, transaction reference and reviewer. Later business edits and plan supersession do not rewrite them. They are payment invoices; tax registration, GST/VAT details and source invoice numbering remain pending.

## Stripe invoice pagination

`GET /api/v1/vendors/:vendorId/billing/invoices?limit=25&startingAfter=in_example` supports 1–100 invoices per page and returns `hasMore` plus `nextCursor`. The customer is selected from the authenticated business; user-provided customers/provider URLs are rejected. Foreign invoice rows, repeated IDs/cursors and malformed pages fail safely. The adapter uses Stripe's documented [invoice list pagination](https://docs.stripe.com/api/invoices/list). Provider calls in tests are mocked; live compatibility remains unverified.
