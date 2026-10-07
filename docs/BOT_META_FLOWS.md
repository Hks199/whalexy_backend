# Native bot Meta Flow launch nodes

WhatsApp bot graphs execute `whatsapp_flow` nodes:

```json
{
  "id": "form",
  "type": "whatsapp_flow",
  "payload": {
    "flow_id": "1234567890",
    "cta_text": "Open Flow",
    "header_text": "Customer form",
    "body_text": "Hello {first_name}",
    "footer_text": "Thank you"
  },
  "next_node": "next_question"
}
```

Use an owned published Flow from the sending number's WhatsApp business account. Static forms require synchronized JSON with a valid starting screen. Forms using data exchange require the native HTTPS endpoint for that credential, a retained encryption key and validated routing configuration. Arbitrary external business endpoints remain unsupported. Presentation strings support graph variables; rendered CTA/header/body/footer limits are 20/60/1,024/60 characters. Missing CTA/body use `Open Flow` and `Tap below to continue.`; header/footer are optional.

Graph save, webhook intake, preview and delayed continuation use local references without provider requests inside their transactions. Runtime resolves every launch before committing graph answers, handoffs or messages. Preview shows proposed references and presentation without issuing tokens. Invalid references or rendered limits retain a blocked event without partial progress.

Each committed launch creates a random opaque token and hashed proof bound to the business, number, recipient/contact, graph revision, Meta Flow revision, credential revision and launch message. Proofs expire after 24 hours. Encrypted data routing and signed form completion reject stale bindings and cancelled launches. A repeated start keyword cancels old queued launches; their tokens cannot submit responses. Completion consumes the token once. Form answers are stored through the existing response processor; they do not automatically advance the bot graph's waiting node.

Dispatch verifies local Flow/JSON/endpoint-configuration/credential revisions, token validity and graph state. It checks current provider publication, validation errors, health and endpoint/action compatibility, then rechecks local state before sending. Stale launches cancel without a provider mutation. Accepted IDs and uncertain sends use existing outbox and callback reconciliation. Recipient, handoff, automation timing and customer-service-window guards still apply.

Successful launch behavior was compared with Laravel WhatsAppFlowNodeHandler and WhatsAppFlowTriggerService. The native path queues delivery and continues through the graph. Source synchronous `failed_next_node` handling, keyword-only launch settings, original canvas/frontend/log-preview/activity contracts, complete response analytics/export and live provider equivalence remain pending. Following messages are separate outbox effects, so source synchronous failure ordering is not verified. This adapter does not complete migration parity.
