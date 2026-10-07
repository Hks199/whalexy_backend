# Standalone WhatsApp interactive messages

`POST /api/v1/vendors/:vendorId/messages/send` now accepts `kind: "interactive"`. It requires the existing reply permission, visible active WhatsApp contact, owned connected number and Idempotency-Key. An incoming message from the exact recipient/number must have opened the current service window; outgoing activity cannot open it. Sender/API-key access, contact identity, number scope, connectivity and the window are checked again before dispatch.

```json
{
  "contactId": 123,
  "phoneNumberId": "1234567890",
  "kind": "interactive",
  "interactive": {
    "type": "button",
    "body": "Which department do you need?",
    "header": { "type": "text", "text": "Support" },
    "footer": "Choose one option",
    "buttons": [
      { "id": "billing", "title": "Billing" },
      { "id": "sales", "title": "Sales" }
    ]
  }
}
```

Reply buttons allow 1–3 unique IDs and unique labels (up to 20 characters). Button headers may be text (60 characters) or image/video/document using the existing public HTTPS URL policy. A document may include a filename without path separators. Private/provider-ID media adapters remain pending.

For a list, set `type: "list"`, `buttonText` (20 characters) and `sections`: `[{ "title": "Support", "rows": [{ "id": "billing", "title": "Billing", "description": "Invoice questions" }] }]`. Native limits are 1–10 titled sections and **10 rows across all sections**, with globally unique row IDs, titles up to 24 characters and optional descriptions up to 72. Lists permit only text headers. Both kinds require a body of up to 1024 characters; footer text is limited to 60. These are conservative native limits, not a claim that every provider version accepts identical bounds. IDs use 1–64 ASCII letters/digits/underscores/hyphens. Controls, unknown fields, unsupported types and incompatible mappings are rejected before messages, proofs or outbox records are written.

The API stores caller choice IDs, but sends random `ni_` choice tokens to the provider. Tokens bind the business, contact ID, recipient identity, phone number, original message, configured label and type, and expire 24 hours after preparation. Idempotent request replay retains the original message and tokens; changed content under the same key conflicts. Expired prepared menus cancel without a provider call. Reconciliation and cancellation of uncertain sends retain the existing rules; the presence of a choice does not automatically retry an uncertain send.

Signed incoming button/list messages retain their normal raw incoming log and receive `data.nativeInteractiveSelection`: `{ "messageId": 123, "choiceId": "billing", "title": "Billing", "type": "button" }`. Display labels come from configuration rather than the incoming label. Duplicate webhook receipts create one incoming record. Unknown/expired/wrong-type/wrong-recipient/wrong-number choices do not receive this metadata. If the original provider message ID is already known, a conflicting supplied context ID is rejected. An early signed reply can be recorded before acknowledgement using the opaque token and exact recipient binding; this is choice correlation, not provider-effect settlement. Repeated distinct clicks can produce distinct incoming records. No automated action is attached to a standalone choice, and native tokens never enter graph-menu routing.

Source references are WhatsAppServiceEngine::sendInteractiveMessageProcess and WhatsAppApiService::sendInteractiveMessage. Payload structure follows [Meta's hosted interactive-message examples](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/). That SDK documentation is archived; current Meta reference pages returned HTTP 429 during this check, so live provider/version compatibility remains unverified. Tests mock provider requests and send no live messages.

Original Laravel URLs/Blade request aliases, numeric response codes, mark-as-read/realtime behavior, source plan/subscription enforcement, carousel variants, legacy bot configuration import and complete legacy contract equivalence remain pending. The original button adapter generated reusable `button-id1` identifiers; this native API deliberately generates recipient-bound tokens instead.

## CTA URL buttons

Use the same endpoint with the following interactive object:

```json
{
  "type": "cta_url",
  "body": "Visit our store",
  "cta": { "title": "Visit store", "url": "https://shop.whalexy.com/offers#details" },
  "header": { "type": "text", "text": "Offers" },
  "footer": "Ask us for help"
}
```

The label allows 1–20 characters with no line breaks or controls. Body/footer/header limits match the button adapter; text and public HTTPS image/video/document headers are supported. A single fixed public HTTPS URL is required (maximum 2048 characters). Fragments and query strings are allowed; credentials, IP/private/local hostnames, nonstandard ports, whitespace, controls and raw placeholder braces are rejected. This is a conservative native URL policy. The backend never fetches or expands a CTA destination. There are no reply choices, choice proofs or inferred click events. Idempotency, prepared-message expiry and existing send/dispatch guards still apply.

Native bot graphs also accept interactive nodes with `interactive_type: "cta_url"`, `text`, `button_display_text` and `button_url`. Body and label can render existing captured variables, subject to the same resolved validation. The destination is fixed configuration; dynamic destinations and legacy import normalization remain pending. A CTA follows its `next_node` automatically and does not become an input/menu node. Automatic cycles are rejected. A following button/list menu retains its own selection tokens; a fabricated CTA reply cannot select it. Invalid rendering blocks the graph step before captured answers or progress commit. Preview creates no deliveries or sessions, and queued graph sends retain revision, handoff, timing, recipient and service-window guards. Graph CTA media/header/footer adapters remain pending.

This follows Laravel WhatsAppApiService::sendInteractiveMessage's `action.name`/`parameters` shape and InteractiveNodeHandler's source field names. The native automatic graph continuation and fixed URL policy are deliberate choices, not verified source contract equivalence. [8x8's provider-owned API specification](https://github.com/8x8Cloud/public-developer-docs/blob/master/docs_oas/connect/business_messaging_api.json) documents the CTA action shape. Current Meta CTA pages returned HTTP 429/timeout; tests mock the provider and live Meta behavior remains unverified.

## Location requests

```json
{
  "type": "location_request_message",
  "body": "Please share your location"
}
```

This sends an interactive `send_location` action. Only a body of 1–1024 characters is supported; headers, footers, custom action overrides, CTA fields and reply choices are rejected. It uses the same owned-recipient, number, idempotency, expiry and service-window guards. There is no custom button label or reply token.

Signed incoming locations retain the ordinary incoming log and raw coordinates/name/address in `data.incoming.location`, including zero coordinates. Duplicate event IDs create one log. Normal incoming-message processing applies; the adapter does not overwrite contact address/name fields, invent a request correlation, claim a user clicked a particular prompt or route a location into a reply-menu branch.

[Sinch's provider-owned explicit WhatsApp channel reference](https://developers.sinch.com/docs/conversation/channel-support/whatsapp/message-support) gives the `location_request_message`/`send_location` payload. Current Meta location-request pages returned HTTP 429. No corresponding Laravel request handler was found in the supplied source: this is a native capability filling the audited adapter gap. It does not convert or activate Laravel's local simulated live-location logs, provide live tracking or establish original route/UI compatibility.
