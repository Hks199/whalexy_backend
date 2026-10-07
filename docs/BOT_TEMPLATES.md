# Native bot template nodes

WhatsApp bot graphs execute `whatsapp_template` nodes through the durable message outbox. For example:

```json
{
  "id": "confirmation",
  "type": "whatsapp_template",
  "payload": {
    "whatsapp_template_id": 123,
    "bodyParameters": [
      { "contactField": "firstName" },
      { "literal": "Your answer: {answer}" }
    ]
  },
  "next_node": "next_question"
}
```

Use an owned, approved, synchronized template. Body and text-header parameter counts must match contiguous numbered placeholders. Each parameter selects one literal, contact field or owned customFieldId, with an optional fallback. Contact fields are firstName, lastName, fullName, phone, email, languageCode and country. Literal/fallback strings can reference captured graph variables. Rendered values are bounded and reject unsupported controls.

Saving a graph validates template ownership, approval, definitions and custom fields, including field references in dynamic URL buttons. Runtime resolves every template in a step before persisting answers, handoffs, messages or session progress. Invalid values or newly unavailable templates retain a blocked event without partially advancing the graph. Delayed continuations resolve current template data before committing; the normal timer recovery rules apply.

Queued sends bind template ID and revision and recheck approval, name, language, marketing opt-out, graph revision, handoff and recipient scope. Opt-out checks include another contact with the same phone in the sending-number scope. These guards stay outside the provider payload. Accepted message identifiers use existing callback reconciliation and prevent repeated dispatch; uncertain effects require reconciliation. A following freeform node still requires an open customer-service window.

Template nodes also accept `mediaHeader`, indexed `buttonParameters` and `copyCode` using the [shared rich-template formats](RICH_TEMPLATES.md). Public image/video/document headers must match the synchronized approved template. Document filenames, URL-button literal/fallback values and coupon codes can reference captured graph variables. Media URLs stay fixed in the graph configuration; user answers cannot choose the remote media URL. Dynamic buttons also accept contact fields and owned customFieldId values. Text is trimmed by the shared renderer; limits, controls, filename and coupon validation apply again after substitution.

A downstream template reads a custom-field answer captured in the current transaction before its stored value is updated, including values used by URL buttons. If any media/filename/button/coupon value is invalid, the entire step retains its prior answer, session position and queued-message count. Delayed continuations revalidate the current approved rich template before progressing. Graph edits invalidate already prepared rich sends through the existing graph revision guard.

Preview returns proposed template IDs and mappings with rendered graph literals, filenames and coupons. It does not resolve private contact/custom values, create sessions or enqueue sends. Named/carousel/Flow-button/private/provider-ID adapters remain pending; unsupported template components are rejected.

The Laravel BotReplyEngine stores the selected template ID/name/language. Its WhatsAppTemplateNodeHandler returns a list of available templates, rather than a provider send. This native adapter implements explicit template delivery; it does not prove equivalence with those legacy responses or original frontend/canvas contracts. Live provider verification, source-data reconciliation and full migration parity remain pending.
