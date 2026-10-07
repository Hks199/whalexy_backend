# Native campaign, store and bot templates

Campaign creation, Shopify/WooCommerce notification rules and WhatsApp bot template nodes now accept numbered text parameters, public image/video/document headers, dynamic URL-button parameters and one copy-code coupon. The approved synchronized template determines which fields are required. Static URL/phone/quick-reply buttons need no send parameters. Unsupported components, duplicate components, non-contiguous text slots, missing or extra mappings and wrong button indices are rejected before configuration is saved. Templates without synchronized component data are also blocked, including older static configurations; synchronize and reconcile them before scheduling.

The existing `bodyParameters` and `headerParameters` arrays are unchanged. Additional fields are:

```json
{
  "mediaHeader": {
    "type": "document",
    "url": "https://cdn.whalexy.com/invoice.pdf",
    "filename": "Invoice.pdf"
  },
  "buttonParameters": [
    { "index": 1, "value": { "literal": "order-123" } }
  ],
  "copyCode": "SAVE10"
}
```

`mediaHeader.type` must match the approved header. URLs must pass the existing public HTTPS media-link policy; this backend does not download them. Documents require a filename of up to 240 characters without path separators or controls; image/video headers forbid filenames. Media URLs are fixed per configuration. Bot document filenames and coupon codes may substitute captured graph variables; see [bot template nodes](BOT_TEMPLATES.md). Dynamic URL buttons use their zero-based index in the complete approved button list, including intervening static buttons. Every dynamic URL button must have exactly one value. Coupon codes are fixed, nonempty text of at most 15 characters and are allowed only where an approved COPY_CODE button exists.

Campaign and bot button values accept the same literals, contact fields and owned custom-field IDs as body/text-header values. Custom-field references are checked and locked at creation, duplication, preflight and audience preparation. Store button values accept literals, order fields and contact fields with a fallback, matching store body/header mappings. Store rules do not accept custom-field IDs. Resolved text is bounded to 1024 characters and cannot contain controls. Invalid campaign recipient values skip that recipient without dropping valid recipients; an invalid preflight or store notification rolls back its message, receipt and related writes.

The campaign preflight and audience use the same renderer. Test acknowledgement and duplication preserve their existing gates; copies require a fresh test when testing is enabled. Newly prepared audience jobs bind the campaign configuration hash and template revision. Changes to media, coupon, parameter mapping or approved template cancel stale prepared sends. Pause, cancellation, recipient scope and marketing opt-out checks remain in force. Historical jobs without these new proofs retain their existing guards and need reconciliation before claiming equivalent protection.

Store notifications retain one receipt/send per store/order/type, number-scoped contact linking, settings/template revision checks and monotonic delivery callbacks. The adapter uses the already-tested Sheets component inspector/renderer; provider tests are mocked, with no live messages sent.

Source references: ShopifyService::prepareTemplateVariables (including dynamic URL buttons), WooCommerceService notification rendering and WhatsAppServiceEngine template/header/button processing. This is a native API adapter, not a verified mapping of the original request fields, Blade forms, uploads or synchronous responses. Original frontend contracts, imported template/settings translation, provider-ID/private uploads, named parameters, carousel/Flow buttons and complete legacy behavior/live-provider proof remain pending. Abandoned-checkout recovery, notification topic coverage and campaign billing/plan rules remain separate gaps.
