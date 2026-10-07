# Original central blog adapters

Ten source declarations have partial adapters under `/central-console/blogs`:

| Method | Path               | Behavior                                        |
| ------ | ------------------ | ----------------------------------------------- |
| GET    | `/`                | Bounded post listing, statistics and categories |
| GET    | `/create`          | Available category/tag editor data              |
| POST   | `/`                | Create a post using source field names          |
| GET    | `/:blog/edit`      | Safe post and editor data                       |
| PUT    | `/:blog`           | Update a post                                   |
| DELETE | `/:blog`           | Soft delete a post                              |
| POST   | `/:blog/duplicate` | Copy as a new draft                             |
| POST   | `/:blog/publish`   | Publish and clear scheduling                    |
| POST   | `/:blog/unpublish` | Move to draft and clear scheduling              |
| GET    | `/:blog/preview`   | Safe authenticated preview JSON                 |

These endpoints require native bearer authentication as a current active site administrator. API keys are rejected. Each legacy read/write and shared native mutation checks current access inside its transaction.

Responses use `{reaction: 1, message, data}`. Post projections use source `_id`, `_uid`, `author_name`, `category_id`, `tag_ids`, scheduling and SEO field names. Content and table of contents are sanitized. Raw author relations, image paths and configuration values are omitted. Editor data includes category/tag IDs, names and slugs. Preview returns `isPreview: true` and does not increment public views.

Create/update accept JSON with `title`, `excerpt`, `content` and required `intent` (`draft`, `preview`, `publish`, `schedule`). Optional source names map to native validated fields: `author_name`, `category_id`, `tag_ids`, `scheduled_at`, `seo_title`, `meta_description`, `meta_keywords`, `canonical_url`, `og_title`, `og_description`, plus `slug` and `locale`. Scheduling requires a future ISO date. Category/tag references must exist, duplicate tags are rejected and explicit slug collisions fail. Optional omitted metadata follows native preservation/default rules.

Every write requires an `Idempotency-Key` of 8–100 letters, digits, underscores or hyphens. Update/delete/lifecycle actions also require the `revision` returned with the post. Mutation, audit and replay share the native content lock and commit atomically. Identical normalized requests replay; changing a request under its key fails. Native edits, scheduling, views or referenced metadata changes can invalidate a revision. Read again before applying a new edit. Replayed deletion still succeeds after soft deletion.

Listing accepts `page`, `limit` (1–100, default 15), `search`, `status` and numeric `category`. Filters combine before pagination. Literal search covers titles, excerpts, content and tags. Statistics summarize all nondeleted posts rather than the filtered page. Duplicate keeps tag/image associations but starts as a draft with zero views and no publication/schedule date. Delete preserves image assets and uses native soft deletion.

Full compatibility remains unverified. Original Blade views, redirects, cookies, flash messages, localization, multipart editor/image uploads, image deletion, inline `new_tags`, source SEO fallback defaults and public-preview related/adjacent data remain pending. Unsupported image/removal/inline-tag fields fail validation. Existing images are preserved. Source schema/import/provider runtime verification and all acceptance gates remain incomplete.

See [adapter tests](../tests/legacy-blogs.test.ts), [native content tests](../tests/content.test.ts) and [API backlog](../migration/API_BACKLOG.md).
