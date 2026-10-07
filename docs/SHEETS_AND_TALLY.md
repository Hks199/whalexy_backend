# Google Sheets automation

Native API prefix: `/api/v1/vendors/:vendorId/sheets`. All routes require `vendor.integrations.manage`. Row submission also requires `vendor.chats.reply`; contact access follows `vendor.chats.view_all` or the user's assignment. API keys may submit rows and read metadata but cannot create, change, delete or download scripts. Key permissions are intersected with current business membership permissions.

| Method/path | Purpose |
|---|---|
| `GET /` | Paginated automation metadata; legacy configurations require regeneration |
| `GET /templates` | Up to 500 approved templates, supported schemas and required variable counts |
| `POST /` | Validate and create an enabled native automation |
| `GET /:uid` | Owned automation metadata |
| `GET /:uid/script` | Download generated `.gs` source without credentials |
| `PATCH /:uid/status` | `{ "enabled": false }` disables automation and invalidates queued sends |
| `DELETE /:uid` | Delete the configuration; durable send history remains |
| `POST /:uid/rows` | `{ "rowId": "stable UUID", "row": ["display", "values"] }`; returns queued message metadata |

Example configuration (column numbers start at zero):

```json
{
  "title": "Order confirmation",
  "spreadsheetId": "your_google_spreadsheet_id",
  "sheetName": "Orders",
  "phoneNumberId": "123456789012345",
  "triggerType": "column_value",
  "phoneColumn": 0,
  "triggerColumn": 2,
  "rowIdColumn": 3,
  "statusColumn": 4,
  "rules": [
    { "templateId": 1, "triggerValue": "Paid", "bodyColumns": [1] }
  ]
}
```

Phone, trigger, row ID and status columns must differ. Row ID/status columns cannot overwrite template input columns. Trigger values are matched after trimming and lowercasing and must be unique. `new_row` requires exactly one rule without a trigger value. Native configurations are immutable; regenerate an automation when the template or mapping changes.

Rules map numbered body/text-header variables using `bodyColumns` and `headerColumns`. Image/video/document headers use `mediaColumn`; documents also require `filenameColumn`. Dynamic URL buttons use `buttonColumns` keyed by provider button index; coupon buttons use `copyCodeColumn`. Parameter counts and button indexes must exactly match the owned approved template. Named parameters, location/carousel/commerce/Flow/OTP buttons and other unsupported formats fail validation. Media URLs must be public HTTPS links; the backend does not fetch them. Empty/control-bearing values, unsafe filenames and coupon codes over 15 characters are rejected.

The row must identify exactly one existing, visible, active WhatsApp contact in the configured business-number scope. Use international phone digits, optionally prefixed by `+`. This native endpoint does not create a contact from arbitrary spreadsheet data. Marketing opt-outs are checked before enqueue and again before dispatch. Dispatch also rechecks automation/template revisions, current membership/key permissions, recipient identity and connection ownership.

Set `PUBLIC_URL` to the application's externally reachable HTTPS origin. In the spreadsheet's Apps Script editor, paste the downloaded script, set **Script Properties → WHALEXY_API_KEY** to a scoped native API key, then run `createTrigger` and authorize it. Only trusted spreadsheet/script collaborators should receive edit access: script properties are shared within the script project. Credentials are neither embedded in generated source nor stored in the automation configuration. Google documents [script properties](https://developers.google.com/apps-script/reference/properties/properties-service), [script locks](https://developers.google.com/apps-script/reference/lock/lock-service), [installable triggers](https://developers.google.com/apps-script/guides/triggers/installable) and [HTTP fetch](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).

New-row monitoring starts after the current last row and is intended for appends. It processes at most 50 rows per run with a three-minute loop budget. A cursor advances only after server queue acknowledgement. Column-value mode uses an installable edit trigger and handles at most 50 edited data rows per batch; edit the unprocessed rows again after a failed/time-limited batch. Script writes and API-originated spreadsheet changes do not automatically fire installable edit triggers. Downloading a script does not install or run it in Google.

The dedicated row ID column stores a UUID before any network call. Preserve these UUIDs when sorting or retrying. The server durably deduplicates each automation/row/rule; changed message values under the same identity are rejected. `resetTracker` safely rechecks existing append-mode rows without clearing server deduplication. Deleting a row, blanking/copying its UUID, reusing an automation's identity for a different data set or regenerating an automation changes the identity assumptions and requires operator reconciliation. No automatic resend follows an uncertain provider effect. `Queued` indicates acceptance into the durable outbox, not successful delivery.

Legacy scripts/configurations are not activated automatically. Generic sheet resources are read-only and hide configuration/generated source. Original Blade views, original URLs/redirects/input names, legacy credential conversion and execution in a real Google account remain unverified.

# Tally invoice delivery

Native prefix: `/api/v1/vendors/:vendorId/tally`. All endpoints require `vendor.integrations.manage`; sending also requires `vendor.chats.reply`. They support authenticated sessions and scoped native API keys.

| Method/path | Purpose |
|---|---|
| `GET /ping` | Authenticated business connectivity check |
| `POST /invoices` | Queue an approved template invoice message |
| `GET /invoices/:sourceId` | Read the immutable invoice summary with current message status; contact visibility is rechecked |

```json
{
  "sourceId": "ledger_a_voucher_123",
  "contactId": 1,
  "phoneNumberId": "123456789012345",
  "templateId": 1,
  "invoiceNumber": "INV_123",
  "invoiceAmount": "1200.50",
  "currency": "INR",
  "invoiceDate": "2026-10-03",
  "pdfUrl": "https://your-public-storage.example.com/invoice.pdf"
}
```

Choose a visible existing contact in the exact connected phone scope and an owned approved template. Document-header templates require a public HTTPS `pdfUrl`; text-only templates must omit it. There is no automatic fallback template or freeform send outside the WhatsApp service window. The endpoint queues delivery and does not charge, settle or authenticate the invoice contents.

Default numbered body fields follow the source controller's order: customer name, invoice number, `Invoice #<number>`, amount. Templates with more than four variables require an explicit `bodyFields` list. Available fields are `customerName`, `invoiceNumber`, `invoiceTitle`, `invoiceAmount`, `invoiceDate`, `companyName`; `headerFields` supports one text-header variable. Business name comes from the authenticated business. Document filenames are generated from the validated invoice number. Dynamic buttons and non-document media headers require another adapter and are rejected.

`sourceId` must remain stable across retries and unique across ledgers/vouchers within the business. Concurrent identical submissions return the same queued message; altered submissions under the same identity return a conflict. The summary endpoint reports current message status instead of claiming that queue acknowledgement proves delivery. Template changes, marketing opt-outs, contact/permission changes and disconnects prevent stale dispatch.

Private uploaded/base64 PDFs, provider media-ID upload, legacy field aliases/default-country guessing/contact creation, original API token/URL/response contracts, Tally connector configuration and live provider verification remain pending. These native APIs and mocked provider tests do not establish full source parity.
