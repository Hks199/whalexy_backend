# Native bot session nodes

`stay_in_session` nodes execute in the WhatsApp bot graph. Their payload is `{ "text": "Still here {first_name}" }`; text is optional, and an empty value uses `Session will remain active...`. They have no outgoing connection. On entry, one message is queued and the session remains waiting. Ordinary text leaves the session active without replaying the entry message.

Previously displayed button/list menus remain available while waiting at this node. Choices are bound to the business, number, contact, graph revision and originating menu. Returning to a menu replaces that menu's tokens. Unknown, foreign and outdated tokens do not advance the graph. A choice leading to another session node retains the current session without duplicating its entry message; other choices follow their branch.

`exit`, `quit`, `end`, `stop`, `bye` and `goodbye` end the session. `restart`, `reset`, `start over` and `begin` clear captured variables and menu tokens while remaining at the session node. Commands ignore surrounding whitespace and case. Reset retains current basic contact variables; it does not jump to the start node. Repeating the configured explicit start keyword still restarts the graph. Exit/reset cancel queued responses from this flow. Already dispatched messages remain subject to the existing delivery reconciliation rules.

These behaviors follow the Laravel `StayInSessionNodeHandler`. The native session does not retain the source handler's unbounded input-history array or send its internal acknowledgment strings. Incoming messages are already retained through normal message intake. Handoff, graph revision, recipient, automation timing and customer-window checks continue to govern dispatch. Existing session expiration applies.

Preview inputs may include `selectionNodeId` alongside `selection` to select an earlier menu while at a session node. Preview uses graph choice IDs; real conversations use generated opaque tokens. It queues no provider effects.

Legacy canvas/reply-record import, original frontend contracts, cross-channel behavior and live provider equivalence remain unverified. Webhook graph handlers remain pending. Native [template delivery](BOT_TEMPLATES.md), [WhatsApp catalog delivery](BOT_CATALOGS.md) and [Meta Flow launches](BOT_META_FLOWS.md) have dedicated adapters. This implementation does not establish full migration parity.
