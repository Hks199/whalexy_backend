# Original campaign APIs

Eight source declarations now have partial Node adapters:

| Method | URL                                                                    |
| ------ | ---------------------------------------------------------------------- |
| GET    | `/vendor-console/whatsapp/campaign/status/:campaignUid/data`           |
| GET    | `/vendor-console/whatsapp/campaign/:status/list-data`                  |
| GET    | `/vendor-console/whatsapp/campaign/queue/:campaignUid`                 |
| GET    | `/vendor-console/whatsapp/campaign/executed/:campaignUid`              |
| POST   | `/vendor-console/whatsapp/campaign/:campaignIdOrUid/duplicate`         |
| POST   | `/vendor-console/whatsapp/campaign/:campaignIdOrUid/delete-process`    |
| POST   | `/vendor-console/whatsapp/campaign/:campaignIdOrUid/archive-process`   |
| POST   | `/vendor-console/whatsapp/campaign/:campaignIdOrUid/unarchive-process` |

Use native bearer/workspace authentication. Every request requires current `vendor.chats.view_all`, plus `vendor.campaigns.view` for reads, `vendor.campaigns.create` for duplication, `vendor.campaigns.send` for archive/restore or the new `vendor.campaigns.delete` permission for deletion. Native and legacy duplicate/archive/restore services share fresh transaction authorization. The native DELETE `/api/v1/vendors/:vendorId/campaigns/:id` uses the same deletion service and returns 204.

Writes require an `Idempotency-Key` of 8?100 letters/digits/underscores/hyphens. Empty bodies are accepted except duplication optionally accepts native `title` and future ISO `scheduledAt`. Actions accept an owned UUID or positive native integer ID. Read details/history require UUIDs. Serializable action transactions commit audit and replay response with changes. Reusing a key for another action/target/body conflicts; repeat deletion can replay after its row is gone.

Duplication validates the owned approved template, connected sender, audience and template values. It copies only native configuration and creates `awaiting_test` regardless of previous test bypass. Execution state/test acknowledgements/private metadata are not copied. Default title appends ` - clone` and the proposed schedule is five minutes ahead; an acknowledged native campaign test is still required. Legacy recreate payloads without a reconciled native configuration fail.

Archive requires a terminal native status and no in-progress provider sends. Restore reinstates the saved stopped status without restarting sends. Delete allows only stopped draft/awaiting-test/cancelled/blocked rows with no queue, message, test-message or provider-job references, including foreign imported references. History and uncertain effects must be reconciled or retained rather than discarded. Audit failure rolls back all action state and idempotency.

Directory route `status` accepts `active`, `archive`/`archived` or `all`. DataTables reads accept `draw`, `start` (0?1,000,000), `length` (1?100, default 25), literal `search[value]`, false `search[regex]`, source `columns[n]` metadata and one `order[0]`. Only supported scalar sort columns are allowed, with a stable ID tie-breaker; column-specific or regex search is rejected. Query normalization is local to these routes and retains the application's simple query parser. Optional status filters combine with the directory scope. Directory search currently covers titles; queue/history search covers phone identifiers. Phone search/sorting require `vendor.contacts.view_phone`; projections otherwise mask identifiers to their final four digits.

Reads use fresh authorization and repeatable-read snapshots. Directory counts exclude foreign templates. Queue/history counts exclude foreign contacts; executed history excludes incoming messages. Responses use DataTables `{draw,recordsTotal,recordsFiltered,data}` and safe source-named fields. Raw campaign configuration, message bodies/webhooks, provider IDs/errors and credentials are omitted. Status uses `{reaction:1,message,data}` with safe campaign identity, native status text, scoped counts and queue-failure count.

Original numeric status/demo/broadcast policies, rich DataTables HTML/full sorting/search, source client models/percentages/timezones, original views/sessions/errors/locale/redirects, legacy payload import, full billing and live provider contracts remain pending. Original XLSX execution/queue/failed reports are not replaced by a different download format and still require conversion. These adapters do not establish full source/frontend compatibility.

Tests: [legacy campaign APIs](../tests/legacy-campaign.test.ts), [native campaign workflows](../tests/campaign-workflows.test.ts).
