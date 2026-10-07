# Source API backlog

Conservative static response hints, not an authoritative runtime API count. Page routes, redirects/files/streams and unresolved responses remain separate; indirect JSON helpers and closures require manual review. An adapter record does not establish behavior parity.

Source declarations: **648**. API-capable declarations identified by static hints: **361**, with **116** partial adapter records and **245** without adapter records.

| Response category | Declarations |
|---|---:|
| api-file | 35 |
| manual-response-review | 160 |
| page-response-hint | 92 |
| api-response-hint | 318 |
| redirect-file-or-stream-hint | 35 |
| mixed-api-page | 8 |

| Controller | API-capable declarations without adapters |
|---|---:|
| FacebookChatServiceController | 30 |
| InstagramServiceController | 29 |
| WhatsAppServiceController | 22 |
| FacebookServiceController | 22 |
| UserController | 15 |
| WhatsAppCallingController | 15 |
| ManualSubscriptionController | 9 |
| WhatsAppTemplateController | 9 |
| MediaController | 8 |
| ConfigurationController | 7 |
| WhatsAppFlowController | 7 |
| AuthController | 7 |
| WhatsAppCommerceController | 6 |
| ShopifyIntegrationController | 6 |
| VendorController | 5 |
| SubscriptionController | 5 |
| TranslationController | 4 |
| AdsManagerController | 4 |
| VendorSettingsController | 4 |
| WhatsAppOrderController | 4 |
| WooCommerceIntegrationController | 4 |
| ShopifyWebhookController | 4 |
| DashboardController | 3 |
| CatalogController | 3 |
| BotFlowController | 3 |
| InstagramWebhookController | 2 |
| CommentToDmController | 2 |
| MetaWebhookController | 1 |
| BlogAdminController | 1 |
| GoogleSheetScriptController | 1 |
| ConversionStudioController | 1 |
| ContactController | 1 |
| HomeController | 1 |

Rebuild with `python scripts/api_backlog.py`. Exact endpoints and source locations are in [api-backlog.json](api-backlog.json). No source response bodies or credentials are included.
