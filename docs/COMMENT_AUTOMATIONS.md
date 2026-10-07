# Verified Facebook and Instagram comment automation

Native workflows use `/api/v1/vendors/:vendorId`. They do not preserve the original Blade views, URL/input names, API tokens or response wrappers.

## Connect a social account

`POST /integrations/social/connect` requires an owner session and `vendor.integrations.manage`. API keys cannot connect accounts. Configure `META_APP_ID`, `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN`, then submit a Page access token obtained for this Meta app:

```json
{
  "platform": "instagram",
  "accountId": "your_instagram_professional_account_id",
  "pageId": "your_linked_facebook_page_id",
  "accessToken": "your_page_access_token"
}
```

For Facebook, `accountId` and `pageId` must be the same Page. Verification checks the provider's token debug response, Page token type, app identity, expiry, required scopes and any granular target restrictions. `/me` must identify the selected Page; Instagram must also match its actual `instagram_business_account`. Looking up a publicly readable account ID is insufficient. Tokens remain encrypted; metadata retains only a fingerprint, identity/expiry proof and verifying actor. Ambiguous ownership across businesses is rejected.

Facebook requires `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_engagement`. Instagram through Facebook Login requires `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`. Required permissions may need Meta approval/Advanced Access for users outside app roles. The endpoint verifies an already obtained Page token; it does not implement a social OAuth browser flow, direct Instagram Login, app review or automatic webhook subscription.

Subscribe the app to the appropriate comment/messaging webhook fields and configure `/webhooks/meta`. Signed `page` feed-comment additions and `instagram` comment changes are recognized. Webhook signature verification and a persisted matching receipt are required; calling the ingestion helper with arbitrary unsigned data cannot queue comment actions. Existing generic social connections need this stronger verification before native comment automation can use them. Disconnect/reconnect, token or app changes invalidate old dispatch guards as appropriate.

## Manage rules

All `/comment-automations` endpoints require an owner session plus `vendor.bot.manage` and `vendor.integrations.manage`.

| Method/path | Purpose |
|---|---|
| `GET /comment-automations` | Paginated nondeleted rules |
| `POST /comment-automations` | Validate, create and bind a rule to the verified account |
| `GET /comment-automations/:id` | Read an owned rule |
| `PUT /comment-automations/:id` | Replace the full rule; invalidates prepared sends from its older revision |
| `DELETE /comment-automations/:id` | Soft-delete and stop the rule while retaining execution history |
| `GET /comment-automations/executions` | Paginated action/follow-gate status; raw legacy provider errors are sanitized |

```json
{
  "name": "Send the guide",
  "platform": "instagram",
  "externalAccountId": "your_instagram_professional_account_id",
  "status": "active",
  "contentScope": "all",
  "commentMatchType": "keyword",
  "matchOperator": "contains",
  "keywords": ["guide", "details"],
  "dmMessage": "Here is your guide",
  "attachment": { "type": "file", "url": "https://your-cdn.example.com/guide.pdf" },
  "publicReplyEnabled": true,
  "publicReplyMessage": "Check your inbox"
}
```

Statuses are `draft`, `active`, `paused`. `contentScope: specific` requires an exact `mediaId`; `all` must omit it. `commentMatchType` is `any` or `keyword`. Keyword comparisons trim/collapse whitespace, lowercase and use literal `contains`, `equals` or `starts_with`; keywords are not executed as regular expressions. Business-authored comments are excluded. Generic comment-rule resources are read-only. Imported rules cannot run until their configuration is regenerated through native management.

A deterministic first matching native rule reserves one private-reply opportunity per platform/account/comment, even if other rules overlap or a webhook is replayed. This is intentionally stricter than attempting every matching rule. Meta's [private-reply documentation](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies) limits the opportunity to one message within seven days and allows conversation continuation after a user response. The worker fetches the actual comment creation timestamp before requesting a reply, using the earlier of provider and signed-event times. Missing/future/expired creation proof prevents sending. Instagram Live remains blocked until active-broadcast handling is verified.

Private replies use the account's `/messages` endpoint addressed by `comment_id`. Public replies use Facebook `/:commentId/comments` or Instagram `/:commentId/replies`. Each is a separately tracked durable external effect. Execution status reports pending, success, partial, waiting-follow, failed, cancelled or uncertain; queue acknowledgement does not prove remote delivery.

Attachments require a public HTTPS URL and never cause the backend to download an arbitrary URL. Instagram files become a text-plus-link reply so only one private message is used. Image-plus-text replies use a generic card with at most 80 characters each for title/subtitle, matching the source's bounded card behavior. Facebook video/audio/file and Instagram video use an attachment message; those attachment formats do not carry an additional text message. Instagram audio private replies and private uploaded/provider-ID attachments need another verified adapter. Combined Instagram file-link text must fit 1,000 characters. Public/private text is bounded to 1,000 characters.

## Instagram follow gates

Add `followGateEnabled: true`, `followGateMessage` and optionally `followGateRetryMessage`. Facebook follow gates are rejected. The initial private reply contains an opaque quick-reply token instead of the final content. The token is bound to the business/account/execution/credential, expires with the configured comment window and never serves as an arbitrary recipient override.

Only a signed, recent, nonecho Instagram button receipt from the provider-confirmed private-reply recipient can queue a follow check. A receipt arriving before the private HTTP response is retained and acted on only after the actual recipient is confirmed. Old, expired, foreign-account and wrong-user receipts cannot open a send window.

The worker reads `id,is_user_follow_business` using the verified account's token. A strict true result permits one content delivery; a false result sends one retry prompt for that button receipt. Another signed click is required to recheck. Each callback decision and each outbound effect is durable; a replay cannot turn the same callback into another send. At most ten distinct follow checks are allowed per execution. Follow checks and sends must occur within 24 hours of the signed user interaction. The original inbox/notification/UI behavior and live profile-permission contracts remain unverified.

## Interrupted effects and review

Each mutation claim commits before contacting Graph. Processing, unknown, malformed, interrupted and rejected effects retain their claims; another worker, webhook, rule or key cannot issue the same effect again. A success followed by local commit failure retains the accepted provider ID for reconciliation. Disabling a rule never rewrites an already unknown send as cancelled. Provider errors are stored as safe codes, not raw credential-bearing messages.

Worker recovery resumes preparation if no mutation claim exists, completes already committed effects and retains claimed unfinished effects as uncertain. Existing owner/central job retry controls may repeat preparation or a committed replay; they reject unresolved/rejected mutation claims. Provider-proven reconciliation of unknown replies, receipt correlation and automatic repair of interrupted follow delivery remain unfinished. Do not clear effect reservations to force a resend.

Native tests use mocked Graph responses and simulated interruptions. Live Facebook/Instagram app scopes, webhook subscription, private/public sends, follow-profile fields and original frontend contracts are not verified by those tests. Social OAuth, content selectors/sync, full conversations/media/publishing/receipts, localization and the other FEATURE_PARITY.md gaps still need conversion.
