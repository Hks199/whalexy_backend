# Native bot catalog nodes

WhatsApp bot graphs execute `catalog` nodes using owned native catalog connections:

```json
{
  "id": "products",
  "type": "catalog",
  "payload": {
    "catalog_id": 123,
    "mode": "multiple",
    "product_ids": [456, 789],
    "body": "Browse {first_name}"
  },
  "next_node": "next_question"
}
```

`single` requires exactly one product; `multiple` requires one to thirty unique products; `catalog` requires an empty product list. Selected products must belong to the catalog and business, be active, visible and synchronized, and have Meta IDs and retailer identifiers. The catalog must have a native credential connection for the sending phone and its WhatsApp business account. Body text is optional, supports graph variables, and is bounded to 1,024 characters after rendering. Product order is preserved.

Saving validates local references. Incoming webhook processing and delayed graph continuation resolve all selected products before committing session progress, field answers, handoffs or messages. They perform no provider requests inside the transaction. Invalid runtime references retain a blocked event without partially advancing the step. Preview returns proposed catalog references and body text without fetching Meta or queueing messages.

Messages carry catalog/connection/product revisions and catalog/phone credential revisions outside the provider payload. Dispatch verifies current local references, reads the WABA catalog linkage through bounded fixed-host pagination, then rechecks local state before sending. Changes, disconnection or remote unlinking cancel the prepared message. Failed provider verification sends nothing. Recipient identity, graph revision, handoff, timing and customer-service-window guards still apply. Accepted IDs and uncertain sends use existing outbox/callback reconciliation; uncertain effects must not be automatically repeated.

The successful WhatsApp modes follow the Laravel CatalogNodeHandler and CatalogMessageService workflow. This native implementation queues delivery and continues through the graph; it does not implement the source synchronous `failed_next_node` branch or social-channel product-card rendering. Original catalog activity/log-preview and canvas/frontend/response contracts, legacy data activation and live provider equivalence remain unverified. Following messages are separate outbox effects; source synchronous failure ordering remains a compatibility gap.
