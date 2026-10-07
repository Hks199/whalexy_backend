# Original bot-flow API adapters

Six original URLs under `/vendor-console/bot-replies/bot-flows` now have partial adapters.

| Method | Path                                | Behavior                                                                                  |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/list-data`                        | Bounded tenant-scoped DataTables projection, literal search, supported single-column sort |
| GET    | `/{botFlowIdOrUid}/get-update-data` | Safe source header fields for an owned flow                                               |
| GET    | `/{botFlowIdOrUid}/export`          | Download a disabled native definition                                                     |
| POST   | `/{botFlowIdOrUid}/clone-process`   | Create an inactive native graph copy with new graph identity                              |
| POST   | `/{botFlowIdOrUid}/delete-process`  | Delete a reconciled native graph and its native owned sessions                            |
| POST   | `/update-process`                   | Update source header fields while preserving graph/sender                                 |

Native bearer workspace authentication and current `vendor.bot.manage` permission apply. Reads use repeatable-read projections; raw builder/provider metadata is omitted. DataTables defaults to 25 rows, caps at 100, normalizes bounded source bracket keys and rejects unsupported columns, regex/column search and unbounded lengths. Status values are native codes and dates are ISO strings.

Writes require `Idempotency-Key` and commit mutation, audit and replay atomically. Replays recheck current permission; conflicting payloads and serialization changes return a conflict. Update accepts source `botFlowIdOrUid`, `title` (150 characters), `trigger_type`, `start_trigger` (255 characters), checkbox `status` and optional single WhatsApp channel selection. It reuses the validated native graph and connected sender. Clone starts inactive, gets a new graph identity and uses a bounded ` - Copy` title. Native update/clone/delete share guards; imported builder metadata, linked reply nodes, social channel configuration or published provider configuration cannot be silently overwritten/copied/deleted. Imported/foreign session references prevent deletion. Queued messages retain existing graph/session revision checks.

The export is an importable native definition with `enabled: false`, not the original canvas/operator/reply archive format. Native graph creation/import endpoints remain available; original add/import/builder URLs are still pending. Complete source title/trigger uniqueness, multichannel behavior, quotas/billing, errors/locales/client models, original frontend/schema reconciliation and live provider comparisons remain unverified. These six records remain partial adapters. See [API backlog](../migration/API_BACKLOG.md).
