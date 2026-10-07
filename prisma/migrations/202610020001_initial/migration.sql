-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "activity_logs" (
    "users__id" INTEGER,
    "vendors__id" INTEGER,
    "activity" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "meta_account_id" TEXT,
    "business_portfolio_id" TEXT,
    "business_portfolio_name" TEXT,
    "facebook_page_id" TEXT,
    "facebook_page_name" TEXT,
    "instagram_account_id" TEXT,
    "instagram_username" TEXT,
    "whatsapp_phone_number_id" TEXT,
    "whatsapp_number" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connection_health" TEXT NOT NULL DEFAULT 'unknown',
    "access_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "auto_sync" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "token_data_access_expires_at" TIMESTAMP(3),
    "last_sync_attempt_at" TIMESTAMP(3),
    "consecutive_sync_failures" INTEGER NOT NULL DEFAULT 0,
    "last_sync_error" TEXT,
    "reconnect_required_at" TIMESTAMP(3),

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaign_label" (
    "id" SERIAL NOT NULL,
    "ad_campaign_id" INTEGER NOT NULL,
    "ad_label_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_campaign_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ad_account_id" INTEGER NOT NULL,
    "meta_campaign_id" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'messages',
    "goal" TEXT NOT NULL DEFAULT 'whatsapp_messages',
    "special_ad_category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effective_status" TEXT NOT NULL DEFAULT 'draft',
    "budget_type" TEXT NOT NULL DEFAULT 'daily',
    "budget_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bid_strategy" TEXT NOT NULL DEFAULT 'lowest_cost',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "notes" TEXT,
    "configuration" JSONB,
    "published_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_conversation_attributions" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "ad_campaign_id" INTEGER,
    "ad_set_id" INTEGER,
    "ad_id" INTEGER,
    "ctwa_click_id" TEXT,
    "source_id" TEXT,
    "source_type" TEXT,
    "placement" TEXT,
    "source_url" TEXT,
    "utm_parameters" JSONB,
    "conversation_started_at" TIMESTAMP(3) NOT NULL,
    "assigned_user_id" INTEGER,
    "conversion_status" TEXT NOT NULL DEFAULT 'conversation',
    "revenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "referral" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_conversation_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "meta_creative_id" TEXT,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'single_image',
    "headline" TEXT,
    "primary_text" TEXT,
    "description" TEXT,
    "call_to_action" TEXT NOT NULL DEFAULT 'SEND_WHATSAPP_MESSAGE',
    "landing_page" TEXT,
    "whatsapp_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "meta" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_labels" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0d9488',
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_notifications" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "notifiable_type" TEXT,
    "notifiable_id" INTEGER,
    "read_at" TIMESTAMP(3),
    "data" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ad_campaign_id" INTEGER NOT NULL,
    "meta_ad_set_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "daily_budget" DECIMAL(18,4),
    "lifetime_budget" DECIMAL(18,4),
    "audience_snapshot" JSONB,
    "placements" JSONB,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ad_set_id" INTEGER NOT NULL,
    "ad_creative_id" INTEGER,
    "meta_ad_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "tracking" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversation_handoffs" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER NOT NULL,
    "assigned_users__id" INTEGER,
    "accepted_by_users__id" INTEGER,
    "open_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "reason" TEXT NOT NULL DEFAULT 'human_handoff',
    "severity" TEXT NOT NULL DEFAULT 'high',
    "requested_at" TIMESTAMP(3) NOT NULL,
    "assigned_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversation_handoffs_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "ai_operation_traces" (
    "id" SERIAL NOT NULL,
    "trace_id" TEXT NOT NULL,
    "vendors__id" INTEGER,
    "operation" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "error_type" TEXT,
    "http_status" INTEGER,
    "duration_ms" INTEGER,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "provider_request_id" TEXT,
    "reference_id" TEXT,
    "metadata" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_operation_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_rules" (
    "id" SERIAL NOT NULL,
    "audience_id" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL DEFAULT 'in',
    "value" JSONB NOT NULL,
    "exclude" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "audience_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audiences" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "meta_audience_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'saved',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "estimated_size_lower" INTEGER,
    "estimated_size_upper" INTEGER,
    "definition" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_categories" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_categories_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "blog_post_tag" (
    "blog_post_id" INTEGER NOT NULL,
    "blog_tag_id" INTEGER NOT NULL,
    "id" SERIAL NOT NULL,

    CONSTRAINT "blog_post_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "author_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_toc" JSONB,
    "featured_image" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "reading_time" INTEGER NOT NULL DEFAULT 1,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "meta_description" TEXT,
    "meta_keywords" TEXT,
    "canonical_url" TEXT,
    "og_title" TEXT,
    "og_description" TEXT,
    "og_image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "author_name" TEXT,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "blog_tags" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_tags_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "bot_flow_message_receipts" (
    "id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_flow_message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_flows" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start_trigger" TEXT,
    "vendors__id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whatsapp_flow_id" TEXT,
    "whatsapp_sync_status" TEXT NOT NULL DEFAULT 'pending',
    "whatsapp_sync_at" TIMESTAMP(3),
    "whatsapp_meta_data" JSONB,
    "trigger_type" TEXT NOT NULL DEFAULT 'is',
    "channels" JSONB,

    CONSTRAINT "bot_flows_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "bot_replies" (
    "vendors__id" INTEGER NOT NULL,
    "bot_flows__id" INTEGER,
    "reply_trigger" TEXT,
    "reply_text" TEXT,
    "trigger_type" TEXT NOT NULL,
    "priority_index" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_replies_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "website" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "meta_brand_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" SERIAL NOT NULL,
    "ad_campaign_id" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'campaign',
    "amount" DECIMAL(18,4) NOT NULL,
    "spent" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "alert_threshold" DECIMAL(18,4) NOT NULL DEFAULT 80,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "hard_limit" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_daily_metrics" (
    "id" SERIAL NOT NULL,
    "ad_campaign_id" INTEGER NOT NULL,
    "metric_date" TIMESTAMP(3) NOT NULL,
    "spend" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_groups" (
    "campaigns__id" INTEGER,
    "contact_groups__id" INTEGER,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_groups_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "campaign_logs" (
    "id" SERIAL NOT NULL,
    "ad_campaign_id" INTEGER,
    "action" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "before" JSONB,
    "after" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_metrics" (
    "id" SERIAL NOT NULL,
    "ad_campaign_id" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "spend" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_templates" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "configuration" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "vendors__id" INTEGER NOT NULL,
    "whatsapp_templates__id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "catalog_activity_logs" (
    "id" SERIAL NOT NULL,
    "catalog_id" INTEGER,
    "event" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "properties" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalog_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_connections" (
    "id" SERIAL NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "business_id" TEXT NOT NULL,
    "catalog_id_external" TEXT NOT NULL,
    "whatsapp_business_account_id" TEXT,
    "access_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "sync_status" TEXT NOT NULL DEFAULT 'connected',
    "connection_health" TEXT NOT NULL DEFAULT 'healthy',
    "last_synced_at" TIMESTAMP(3),
    "last_health_check_at" TIMESTAMP(3),
    "last_error" TEXT,
    "meta" JSONB,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "phone_number_id" TEXT,

    CONSTRAINT "catalog_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_exports" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "disk" TEXT NOT NULL DEFAULT 'local',
    "path" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB,
    "error" TEXT,
    "expires_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalog_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_imports" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "format" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "disk" TEXT NOT NULL DEFAULT 'local',
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_file_path" TEXT,
    "mapping" JSONB,
    "summary" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalog_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_settings" (
    "id" SERIAL NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "default_tax_rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "weight_unit" TEXT NOT NULL DEFAULT 'kg',
    "dimension_unit" TEXT NOT NULL DEFAULT 'cm',
    "default_shipping_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "storage_disk" TEXT NOT NULL DEFAULT 'public',
    "image_quality" INTEGER NOT NULL DEFAULT 82,
    "max_image_size_kb" INTEGER NOT NULL DEFAULT 5120,
    "meta_auto_sync" BOOLEAN NOT NULL DEFAULT true,
    "auto_retry" BOOLEAN NOT NULL DEFAULT true,
    "max_sync_attempts" INTEGER NOT NULL DEFAULT 4,
    "notifications" JSONB,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalog_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_sync_logs" (
    "id" SERIAL NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "external_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalog_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "meta_catalog_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'not_connected',
    "last_synced_at" TIMESTAMP(3),
    "limits" JSONB,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "image_url" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "meta_category_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_products" (
    "id" SERIAL NOT NULL,
    "collection_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "meta_product_set_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_to_dm_automations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "external_account_id" TEXT NOT NULL,
    "content_scope" TEXT NOT NULL DEFAULT 'all',
    "media_id" TEXT,
    "media_label" TEXT,
    "comment_match_type" TEXT NOT NULL DEFAULT 'any',
    "match_operator" TEXT NOT NULL DEFAULT 'contains',
    "keywords" JSONB,
    "dm_message" TEXT NOT NULL,
    "public_reply_enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_reply_message" TEXT,
    "last_triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "dm_attachment_type" TEXT,
    "dm_attachment_url" TEXT,
    "dm_attachment_path" TEXT,
    "dm_attachment_name" TEXT,
    "follow_gate_enabled" BOOLEAN NOT NULL DEFAULT false,
    "follow_gate_message" TEXT,
    "follow_gate_retry_message" TEXT,

    CONSTRAINT "comment_to_dm_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_to_dm_executions" (
    "id" SERIAL NOT NULL,
    "automation_id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "media_id" TEXT,
    "commenter_id" TEXT,
    "matched_at" TIMESTAMP(3) NOT NULL,
    "dm_status" TEXT NOT NULL DEFAULT 'pending',
    "public_reply_status" TEXT NOT NULL DEFAULT 'skipped',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "follow_gate_status" TEXT NOT NULL DEFAULT 'disabled',
    "follow_gate_recipient_id" TEXT,
    "follow_gate_checks" INTEGER NOT NULL DEFAULT 0,
    "follow_gate_checked_at" TIMESTAMP(3),
    "content_delivered_at" TIMESTAMP(3),

    CONSTRAINT "comment_to_dm_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configurations" (
    "name" TEXT NOT NULL,
    "value" TEXT,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configurations_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "contact_custom_field_values" (
    "contacts__id" INTEGER NOT NULL,
    "contact_custom_fields__id" INTEGER NOT NULL,
    "field_value" TEXT,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_custom_field_values_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "contact_custom_fields" (
    "vendors__id" INTEGER NOT NULL,
    "input_name" TEXT NOT NULL,
    "input_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_custom_fields_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "contact_groups" (
    "wab_phone_number_id" TEXT,
    "vendors__id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_groups_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "contact_labels" (
    "contacts__id" INTEGER NOT NULL,
    "labels__id" INTEGER NOT NULL,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_labels_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "platform" TEXT,
    "instagram_id" TEXT,
    "instagram_username" TEXT,
    "conversation_status" TEXT NOT NULL DEFAULT 'open',
    "conversation_resolved_at" TIMESTAMP(3),
    "conversation_resolved_by_user_id" INTEGER,
    "conversation_resolution_sequence" INTEGER NOT NULL DEFAULT 0,
    "facebook_id" TEXT,
    "wab_phone_number_id" TEXT,
    "vendors__id" INTEGER NOT NULL,
    "wa_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "assigned_users__id" INTEGER,
    "countries__id" INTEGER,
    "messaged_at" TIMESTAMP(3),
    "unread_messages_count" INTEGER NOT NULL DEFAULT 0,
    "disable_ai_bot" INTEGER NOT NULL DEFAULT 0,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "conversation_ai_analysis" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "intent" TEXT,
    "intent_confidence" INTEGER,
    "sentiment" TEXT,
    "sentiment_confidence" INTEGER,
    "urgency" TEXT,
    "risk_level" TEXT,
    "lead_score" INTEGER NOT NULL DEFAULT 0,
    "lead_category" TEXT,
    "ai_insight" TEXT,
    "conversation_summary" TEXT,
    "next_best_action" TEXT,
    "suggested_replies" JSONB,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_classification_logs" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by_users__id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_classification_logs_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "conversation_classification_tags" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "icon" TEXT,
    "category" TEXT,
    "created_by_users__id" INTEGER,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_classification_tags_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "conversation_classifications" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER NOT NULL,
    "intent" TEXT,
    "sentiment" TEXT,
    "urgency" TEXT,
    "risk_level" TEXT,
    "updated_by_users__id" INTEGER,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_classifications_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "conversation_cx_scores" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "agent_id" INTEGER,
    "resolution_sequence" INTEGER NOT NULL DEFAULT 1,
    "cx_score" DECIMAL(18,4),
    "rating" TEXT,
    "summary" TEXT,
    "reason_json" JSONB,
    "recommended_action" TEXT,
    "follow_up_required" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_message" TEXT,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_cx_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" SERIAL NOT NULL,
    "conversion_id" INTEGER NOT NULL,
    "event_name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ad_campaign_id" INTEGER,
    "ad_id" INTEGER,
    "external_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "contact_wa_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "attribution" JSONB,
    "meta" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "name" TEXT NOT NULL,
    "phone_code" TEXT,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "creative_assets" (
    "id" SERIAL NOT NULL,
    "ad_creative_id" INTEGER,
    "type" TEXT NOT NULL,
    "disk" TEXT NOT NULL DEFAULT 'public',
    "path" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT NOT NULL,
    "tags" JSONB,
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "creative_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_jobs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "connection" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "exception" TEXT NOT NULL,
    "failed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_sheet_automations" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL DEFAULT 'new_row',
    "status" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB,
    "generated_script" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_sheet_automations_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "group_contacts" (
    "contacts__id" INTEGER NOT NULL,
    "contact_groups__id" INTEGER NOT NULL,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_contacts_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "instagram_message_logs" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "instagram_page_id" TEXT,
    "contact_instagram_id" TEXT,
    "message_id" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT,
    "type" TEXT,
    "is_incoming_message" BOOLEAN NOT NULL DEFAULT false,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "messaged_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "replied_to_instagram_message_logs__uid" TEXT,
    "is_forwarded" BOOLEAN NOT NULL DEFAULT false,
    "bot_reply" BOOLEAN NOT NULL DEFAULT false,
    "disable_ai_bot" BOOLEAN NOT NULL DEFAULT false,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_message_logs_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" SERIAL NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "reserved_at" INTEGER,
    "available_at" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "vendors__id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "color" TEXT,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "users__id" INTEGER NOT NULL,
    "ip_address" TEXT,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "manual_subscriptions" (
    "vendors__id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_subscriptions_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "out_of_office_deliveries" (
    "_id" SERIAL NOT NULL,
    "out_of_office_settings__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "customer_identifier" TEXT NOT NULL,
    "ooo_period_key" TEXT NOT NULL,
    "inbound_message_id" TEXT,
    "outbound_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "failure_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "out_of_office_deliveries_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "out_of_office_schedules" (
    "_id" SERIAL NOT NULL,
    "out_of_office_settings__id" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "out_of_office_schedules_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "out_of_office_settings" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "whatsapp_phone_number_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "mode" TEXT NOT NULL DEFAULT 'business_hours',
    "manual_until" TIMESTAMP(3),
    "manual_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "out_of_office_settings_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "pages" (
    "title" TEXT NOT NULL,
    "content" TEXT,
    "status" INTEGER NOT NULL,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "pending_registrations" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'image',
    "disk" TEXT NOT NULL DEFAULT 'public',
    "path" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "price" DECIMAL(18,4),
    "sale_price" DECIMAL(18,4),
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "availability" TEXT NOT NULL DEFAULT 'in_stock',
    "options" JSONB NOT NULL,
    "meta_product_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "catalog_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "brand_id" INTEGER,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "sale_price" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "tax_rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "availability" TEXT NOT NULL DEFAULT 'in_stock',
    "barcode" TEXT,
    "weight" DECIMAL(18,4),
    "length" DECIMAL(18,4),
    "width" DECIMAL(18,4),
    "height" DECIMAL(18,4),
    "requires_shipping" BOOLEAN NOT NULL DEFAULT true,
    "shipping_cost" DECIMAL(18,4),
    "delivery_time" TEXT,
    "return_policy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'visible',
    "condition" TEXT NOT NULL DEFAULT 'new',
    "meta_title" TEXT,
    "meta_description" TEXT,
    "custom_url" TEXT,
    "meta_product_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "attributes" JSONB,
    "published_at" TIMESTAMP(3),
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "primary_image_url" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filters" JSONB,
    "schedule" TEXT,
    "file_path" TEXT,
    "generated_at" TIMESTAMP(3),
    "organization_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_integrations" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "webhook_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "notification_types" TEXT,
    "webhook_url" TEXT,
    "connected_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_integrations_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "shopify_order_notifications" (
    "_id" SERIAL NOT NULL,
    "shopify_orders__id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "notification_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message_id" TEXT,
    "whatsapp_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "error_message" TEXT,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "_uid" TEXT NOT NULL,

    CONSTRAINT "shopify_order_notifications_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "shopify_orders" (
    "_id" SERIAL NOT NULL,
    "shopify_integrations__id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "shopify_order_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "financial_status" TEXT NOT NULL DEFAULT 'pending',
    "fulfillment_status" TEXT NOT NULL DEFAULT 'unfulfilled',
    "total_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "subtotal_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_discounts" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_weight" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "processed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at_shopify" TIMESTAMP(3),
    "updated_at_shopify" TIMESTAMP(3),
    "processed_at_shopify" TIMESTAMP(3),
    "cancelled_at_shopify" TIMESTAMP(3),
    "closed_at_shopify" TIMESTAMP(3),
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "_uid" TEXT NOT NULL,

    CONSTRAINT "shopify_orders_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "subscription_addons" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "addon_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "source" TEXT NOT NULL DEFAULT 'paid',
    "started_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "payment_provider" TEXT,
    "payment_reference" TEXT,
    "provider_subscription_reference" TEXT,
    "enabled_by" INTEGER,
    "enabled_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_addons_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "vendor_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "stripe_id" TEXT NOT NULL,
    "stripe_status" TEXT NOT NULL,
    "stripe_price" TEXT,
    "quantity" INTEGER,
    "trial_ends_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_registry" (
    "jwt_token" TEXT,
    "user_authorities__id" INTEGER,
    "expiry_at" TIMESTAMP(3),
    "status" INTEGER NOT NULL,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_registry_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "user_active_flows" (
    "__data" JSONB,
    "current_node_uid" TEXT,
    "next_node_uid" TEXT,
    "id" SERIAL NOT NULL,

    CONSTRAINT "user_active_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "title" TEXT NOT NULL,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "users" (
    "phone_verified_at" TIMESTAMP(3),
    "current_vendor_id" INTEGER,
    "active_session_id" TEXT,
    "active_session_last_activity" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone_number" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "vendors__id" INTEGER,
    "user_roles__id" INTEGER,
    "email_verified_at" TIMESTAMP(3),
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "vendor_ai_monthly_invoices" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "billing_period" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "raw_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "usage_breakdown" JSONB,
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_ai_monthly_invoices_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "vendor_ai_usages" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'groq',
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "raw_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "billed_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reference_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_ai_usages_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "vendor_settings" (
    "vendors__id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "data_type" INTEGER,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_settings_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "vendor_users" (
    "users__id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_users_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "account_type" TEXT NOT NULL DEFAULT 'customer',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "industry" TEXT,
    "website_url" TEXT,
    "business_description" TEXT,
    "company_size" TEXT,
    "target_audience" TEXT,
    "primary_goal" TEXT,
    "monthly_volume" TEXT,
    "ecommerce_platform" TEXT,
    "whatsapp_experience" TEXT,
    "title" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "users__id" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'email',
    "destination" TEXT NOT NULL,
    "code_hash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_automation_settings" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger_keywords" JSONB,
    "reminder_offsets_minutes" JSONB,
    "reminder_template_name" TEXT,
    "reminder_template_language" TEXT NOT NULL DEFAULT 'en_US',
    "confirmation_message" TEXT,
    "reminder_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "system_enabled" BOOLEAN NOT NULL DEFAULT true,
    "message_templates" JSONB,

    CONSTRAINT "whalexy_appointment_automation_settings_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_conversation_states" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "context" JSONB,
    "last_message_wamid" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_conversation_states_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_holds" (
    "_id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "appointment_service_id" INTEGER NOT NULL,
    "appointment_resource_id" INTEGER NOT NULL,
    "starts_at_utc" TIMESTAMP(3) NOT NULL,
    "ends_at_utc" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_holds_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_reminder_deliveries" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "appointment_id" INTEGER NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_reminder_deliveries_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_resources" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'staff',
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "users__id" INTEGER,
    "auto_assign_chat" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "whalexy_appointment_resources_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_schedule_exceptions" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "appointment_resource_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'unavailable',
    "starts_at_utc" TIMESTAMP(3) NOT NULL,
    "ends_at_utc" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_schedule_exceptions_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_schedules" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "appointment_resource_id" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_local_time" TEXT NOT NULL,
    "end_local_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "effective_from" TIMESTAMP(3),
    "effective_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_schedules_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_service_resources" (
    "id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "appointment_service_id" INTEGER NOT NULL,
    "appointment_resource_id" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_service_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_services" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4),
    "currency" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_services_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointment_slot_claims" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "appointment_id" INTEGER NOT NULL,
    "appointment_resource_id" INTEGER NOT NULL,
    "slot_start_utc" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointment_slot_claims_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whalexy_appointments" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "appointment_service_id" INTEGER NOT NULL,
    "appointment_resource_id" INTEGER NOT NULL,
    "starts_at_utc" TIMESTAMP(3) NOT NULL,
    "ends_at_utc" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "source" TEXT NOT NULL DEFAULT 'api',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "customer_email" TEXT,
    "notes" TEXT,
    "external_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whalexy_appointments_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_blue_tick_applications" (
    "id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "waba_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "legal_business_name" TEXT NOT NULL,
    "website_url" TEXT NOT NULL,
    "business_category" TEXT,
    "news_urls" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "meta_checked_at" TIMESTAMP(3),
    "meta_snapshot" JSONB,
    "meta_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta_case_id" TEXT,
    "meta_submission_url" TEXT,
    "reviewer_notes" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "meta_submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_blue_tick_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_call_artifacts" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "meta_media_id" TEXT NOT NULL,
    "sha256" TEXT,
    "mime_type" TEXT,
    "disk" TEXT,
    "path" TEXT,
    "failure_reason" TEXT,
    "available_at" TIMESTAMP(3),
    "retained_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_call_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_call_events" (
    "id" SERIAL NOT NULL,
    "call_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_calling_settings" (
    "id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "outbound_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
    "transcription_enabled" BOOLEAN NOT NULL DEFAULT false,
    "artifact_purpose" TEXT,
    "announcement_language" TEXT NOT NULL DEFAULT 'en_IN',

    CONSTRAINT "whatsapp_calling_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_calls" (
    "id" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "meta_call_id" TEXT,
    "request_id" TEXT,
    "contact_uid" TEXT,
    "peer" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "agent_id" INTEGER,
    "room_name" TEXT NOT NULL,
    "session" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recording_requested" BOOLEAN NOT NULL DEFAULT false,
    "transcription_requested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "whatsapp_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_launch_settings" (
    "_id" SERIAL NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "flow_id" TEXT NOT NULL,
    "launch_type" TEXT NOT NULL DEFAULT 'template',
    "launch_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_keywords" TEXT,
    "automation_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "whatsapp_flow_launch_settings_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_flow_responses" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "flow_id" TEXT NOT NULL,
    "flow_name" TEXT,
    "wamid" TEXT,
    "response_data" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_flow_responses_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_message_logs" (
    "type" TEXT,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER NOT NULL,
    "campaigns__id" INTEGER,
    "whatsapp_message_id" TEXT,
    "wab_phone_number_id" TEXT,
    "message" TEXT,
    "status" TEXT,
    "is_incoming_message" BOOLEAN NOT NULL,
    "messaged_at" TIMESTAMP(3) NOT NULL,
    "replied_to_whatsapp_message_logs__uid" TEXT,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_message_logs_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_message_queue" (
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "campaigns__id" INTEGER NOT NULL,
    "phone_with_country_code" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_message_queue_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_onboarding_connections" (
    "id" SERIAL NOT NULL,
    "onboarding_id" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "business_id" TEXT,
    "waba_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "display_phone_number" TEXT,
    "verified_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "current_step" TEXT NOT NULL DEFAULT 'RECEIVED',
    "phone_state" TEXT NOT NULL DEFAULT 'NEW',
    "registration_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "webhook_status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "token_type" TEXT,
    "account_mode" TEXT,
    "last_error" JSONB,
    "meta" JSONB,
    "last_synced_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connection_mode" TEXT NOT NULL DEFAULT 'cloud_api',
    "contacts_sync_status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "history_sync_status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "contacts_sync_request_id" TEXT,
    "history_sync_request_id" TEXT,
    "history_sync_progress" INTEGER NOT NULL DEFAULT 0,
    "sync_requested_at" TIMESTAMP(3),
    "sync_completed_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_onboarding_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_orders" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "customer_phone" TEXT NOT NULL,
    "customer_name" TEXT,
    "items" JSONB NOT NULL,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shipping_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "delivery_address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_id" TEXT,
    "payment_status" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "__data" JSONB,
    "ordered_at" TIMESTAMP(3),
    "payment_completed_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_orders_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_payments" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_method" TEXT,
    "transaction_id" TEXT,
    "payment_link_id" TEXT,
    "payment_link_url" TEXT,
    "gateway" TEXT NOT NULL DEFAULT 'razorpay',
    "gateway_response" JSONB,
    "__data" JSONB,
    "payment_initiated_at" TIMESTAMP(3),
    "payment_completed_at" TIMESTAMP(3),
    "payment_failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_payments_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "meta_template_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "quality_rating" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "compliance_score" INTEGER,
    "compliance_details" JSONB,
    "version_history" JSONB,
    "analytics_summary" JSONB,
    "preset_key" TEXT,
    "vendors__id" INTEGER NOT NULL,
    "template_name" TEXT NOT NULL,
    "template_id" TEXT,
    "language_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT,
    "__data" JSONB,
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "whatsapp_user_states" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "phone" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "order_id" TEXT,
    "context" TEXT,
    "__data" JSONB,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_user_states_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "woocommerce_integrations" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "site_url" TEXT NOT NULL,
    "consumer_key" TEXT NOT NULL,
    "consumer_secret" TEXT NOT NULL,
    "webhook_ids" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "notification_types" TEXT,
    "webhook_url" TEXT,
    "connected_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "settings" JSONB,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "woocommerce_integrations_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "woocommerce_order_notifications" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "woocommerce_orders__id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "whatsapp_templates__id" INTEGER,
    "notification_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message_id" TEXT,
    "whatsapp_message_id" TEXT,
    "variables" JSONB,
    "response" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "error_message" TEXT,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "woocommerce_order_notifications_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "woocommerce_orders" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "woocommerce_integrations__id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "contacts__id" INTEGER,
    "woocommerce_order_id" INTEGER NOT NULL,
    "order_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payment_method" TEXT,
    "payment_method_title" TEXT,
    "shipping_method" TEXT,
    "shipping_method_title" TEXT,
    "total_tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_shipping" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "customer_note" TEXT,
    "order_notes" TEXT,
    "date_created" TIMESTAMP(3),
    "date_modified" TIMESTAMP(3),
    "date_completed" TIMESTAMP(3),
    "date_paid" TIMESTAMP(3),
    "date_processing" TIMESTAMP(3),
    "date_on_hold" TIMESTAMP(3),
    "date_cancelled" TIMESTAMP(3),
    "date_refunded" TIMESTAMP(3),
    "customer_data" JSONB,
    "order_data" JSONB,
    "__data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "woocommerce_orders_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "node_auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_verification_challenges" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_outbox_jobs" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_webhook_receipts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_integration_credentials" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_audit_events" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_api_keys" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_memberships" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "node_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_booking_claims" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "resourceId" INTEGER NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "slot" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_booking_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_idempotency" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_media" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_channel_messages" (
    "id" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "text" TEXT,
    "incoming" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_logs__uid_key" ON "activity_logs"("_uid");

-- CreateIndex
CREATE INDEX "activity_logs_vendors__id_idx" ON "activity_logs"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_uuid_key" ON "ad_accounts"("uuid");

-- CreateIndex
CREATE INDEX "ad_accounts_vendor_id_idx" ON "ad_accounts"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "2870e78cd6ccfcf903a50c9c" ON "ad_accounts"("vendor_id", "meta_account_id");

-- CreateIndex
CREATE INDEX "ad_campaign_label_vendor_id_idx" ON "ad_campaign_label"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "b14d00009334be42762bfb7b" ON "ad_campaign_label"("ad_campaign_id", "ad_label_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaigns_uuid_key" ON "ad_campaigns"("uuid");

-- CreateIndex
CREATE INDEX "ad_campaigns_vendor_id_idx" ON "ad_campaigns"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ddb0918e3ab89b77f9a31c3c" ON "ad_campaigns"("vendor_id", "meta_campaign_id");

-- CreateIndex
CREATE INDEX "ad_conversation_attributions_vendor_id_idx" ON "ad_conversation_attributions"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "aff2483e96cc1200c54d10c4" ON "ad_conversation_attributions"("vendor_id", "contact_id", "ctwa_click_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_creatives_uuid_key" ON "ad_creatives"("uuid");

-- CreateIndex
CREATE INDEX "ad_creatives_vendor_id_idx" ON "ad_creatives"("vendor_id");

-- CreateIndex
CREATE INDEX "ad_labels_vendor_id_idx" ON "ad_labels"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "11bea94cc80ff8c1170cf8e5" ON "ad_labels"("vendor_id", "name");

-- CreateIndex
CREATE INDEX "ad_notifications_vendor_id_idx" ON "ad_notifications"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_sets_uuid_key" ON "ad_sets"("uuid");

-- CreateIndex
CREATE INDEX "ad_sets_vendor_id_idx" ON "ad_sets"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ads_uuid_key" ON "ads"("uuid");

-- CreateIndex
CREATE INDEX "ads_vendor_id_idx" ON "ads"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_handoffs__uid_key" ON "ai_conversation_handoffs"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_handoffs_open_key_key" ON "ai_conversation_handoffs"("open_key");

-- CreateIndex
CREATE INDEX "ai_conversation_handoffs_vendors__id_idx" ON "ai_conversation_handoffs"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_operation_traces_trace_id_key" ON "ai_operation_traces"("trace_id");

-- CreateIndex
CREATE INDEX "ai_operation_traces_vendors__id_idx" ON "ai_operation_traces"("vendors__id");

-- CreateIndex
CREATE INDEX "audience_rules_vendor_id_idx" ON "audience_rules"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "audiences_uuid_key" ON "audiences"("uuid");

-- CreateIndex
CREATE INDEX "audiences_vendor_id_idx" ON "audiences"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "blog_categories__uid_key" ON "blog_categories"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "blog_categories_slug_key" ON "blog_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts__uid_key" ON "blog_posts"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "blog_tags__uid_key" ON "blog_tags"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "blog_tags_slug_key" ON "blog_tags"("slug");

-- CreateIndex
CREATE INDEX "bot_flow_message_receipts_vendors__id_idx" ON "bot_flow_message_receipts"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "2484dc0e3eb50fb2aa71e0cb" ON "bot_flow_message_receipts"("vendors__id", "channel", "external_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_flows__uid_key" ON "bot_flows"("_uid");

-- CreateIndex
CREATE INDEX "bot_flows_vendors__id_idx" ON "bot_flows"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_replies__uid_key" ON "bot_replies"("_uid");

-- CreateIndex
CREATE INDEX "bot_replies_vendors__id_idx" ON "bot_replies"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_uuid_key" ON "brands"("uuid");

-- CreateIndex
CREATE INDEX "brands_vendor_id_idx" ON "brands"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "4f6825728bf8a729ea289c1e" ON "brands"("catalog_id", "slug");

-- CreateIndex
CREATE INDEX "budgets_vendor_id_idx" ON "budgets"("vendor_id");

-- CreateIndex
CREATE INDEX "campaign_daily_metrics_vendor_id_idx" ON "campaign_daily_metrics"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "604f8633b0c83f20d367fa15" ON "campaign_daily_metrics"("ad_campaign_id", "metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_groups__uid_key" ON "campaign_groups"("_uid");

-- CreateIndex
CREATE INDEX "campaign_logs_vendor_id_idx" ON "campaign_logs"("vendor_id");

-- CreateIndex
CREATE INDEX "campaign_metrics_vendor_id_idx" ON "campaign_metrics"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_templates_uuid_key" ON "campaign_templates"("uuid");

-- CreateIndex
CREATE INDEX "campaign_templates_vendor_id_idx" ON "campaign_templates"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns__uid_key" ON "campaigns"("_uid");

-- CreateIndex
CREATE INDEX "campaigns_vendors__id_idx" ON "campaigns"("vendors__id");

-- CreateIndex
CREATE INDEX "catalog_activity_logs_vendor_id_idx" ON "catalog_activity_logs"("vendor_id");

-- CreateIndex
CREATE INDEX "catalog_connections_vendor_id_idx" ON "catalog_connections"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "9393f7f22af1fdf9e2cc7018" ON "catalog_connections"("catalog_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "d06e4280afb1132113f7b5fc" ON "catalog_connections"("vendor_id", "provider", "catalog_id_external");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_exports_uuid_key" ON "catalog_exports"("uuid");

-- CreateIndex
CREATE INDEX "catalog_exports_vendor_id_idx" ON "catalog_exports"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_imports_uuid_key" ON "catalog_imports"("uuid");

-- CreateIndex
CREATE INDEX "catalog_imports_vendor_id_idx" ON "catalog_imports"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_settings_catalog_id_key" ON "catalog_settings"("catalog_id");

-- CreateIndex
CREATE INDEX "catalog_settings_vendor_id_idx" ON "catalog_settings"("vendor_id");

-- CreateIndex
CREATE INDEX "catalog_sync_logs_vendor_id_idx" ON "catalog_sync_logs"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogs_uuid_key" ON "catalogs"("uuid");

-- CreateIndex
CREATE INDEX "catalogs_vendor_id_idx" ON "catalogs"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "996eba0e8d1621618741bcb2" ON "catalogs"("vendor_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "c3d993a52507d69629d8e058" ON "catalogs"("vendor_id", "meta_catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_uuid_key" ON "categories"("uuid");

-- CreateIndex
CREATE INDEX "categories_vendor_id_idx" ON "categories"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "5dbe1c84f86344e2d9a216b8" ON "categories"("catalog_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "b7d2b9171ea1c5eb3f17e631" ON "collection_products"("collection_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "collections_uuid_key" ON "collections"("uuid");

-- CreateIndex
CREATE INDEX "collections_vendor_id_idx" ON "collections"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "e094176a0181b0a85b364f60" ON "collections"("catalog_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "comment_to_dm_automations_uuid_key" ON "comment_to_dm_automations"("uuid");

-- CreateIndex
CREATE INDEX "comment_to_dm_automations_vendors__id_idx" ON "comment_to_dm_automations"("vendors__id");

-- CreateIndex
CREATE INDEX "comment_to_dm_executions_vendors__id_idx" ON "comment_to_dm_executions"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "f7eb0345313c1f1ed2fd0980" ON "comment_to_dm_executions"("automation_id", "comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "configurations__uid_key" ON "configurations"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_field_values__uid_key" ON "contact_custom_field_values"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_custom_fields__uid_key" ON "contact_custom_fields"("_uid");

-- CreateIndex
CREATE INDEX "contact_custom_fields_vendors__id_idx" ON "contact_custom_fields"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_groups__uid_key" ON "contact_groups"("_uid");

-- CreateIndex
CREATE INDEX "contact_groups_vendors__id_idx" ON "contact_groups"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_labels__uid_key" ON "contact_labels"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "contacts__uid_key" ON "contacts"("_uid");

-- CreateIndex
CREATE INDEX "contacts_vendors__id_idx" ON "contacts"("vendors__id");

-- CreateIndex
CREATE INDEX "conversation_ai_analysis_vendors__id_idx" ON "conversation_ai_analysis"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "3bf46fdd5ba0e1ca4bd42bbc" ON "conversation_ai_analysis"("vendors__id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_classification_logs__uid_key" ON "conversation_classification_logs"("_uid");

-- CreateIndex
CREATE INDEX "conversation_classification_logs_vendors__id_idx" ON "conversation_classification_logs"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_classification_tags__uid_key" ON "conversation_classification_tags"("_uid");

-- CreateIndex
CREATE INDEX "conversation_classification_tags_vendors__id_idx" ON "conversation_classification_tags"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "0ccd62b47c106b611abe9e1b" ON "conversation_classification_tags"("vendors__id", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_classifications__uid_key" ON "conversation_classifications"("_uid");

-- CreateIndex
CREATE INDEX "conversation_classifications_vendors__id_idx" ON "conversation_classifications"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "62489c023bd0f32bd65d79d7" ON "conversation_classifications"("vendors__id", "contacts__id");

-- CreateIndex
CREATE INDEX "conversation_cx_scores_vendors__id_idx" ON "conversation_cx_scores"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "631072ab7afa60efb49103c5" ON "conversation_cx_scores"("vendors__id", "conversation_id", "resolution_sequence");

-- CreateIndex
CREATE INDEX "conversion_events_vendor_id_idx" ON "conversion_events"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_uuid_key" ON "conversions"("uuid");

-- CreateIndex
CREATE INDEX "conversions_vendor_id_idx" ON "conversions"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "countries__uid_key" ON "countries"("_uid");

-- CreateIndex
CREATE INDEX "creative_assets_vendor_id_idx" ON "creative_assets"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "failed_jobs_uuid_key" ON "failed_jobs"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "google_sheet_automations__uid_key" ON "google_sheet_automations"("_uid");

-- CreateIndex
CREATE INDEX "google_sheet_automations_vendors__id_idx" ON "google_sheet_automations"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "group_contacts__uid_key" ON "group_contacts"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "instagram_message_logs__uid_key" ON "instagram_message_logs"("_uid");

-- CreateIndex
CREATE INDEX "instagram_message_logs_vendors__id_idx" ON "instagram_message_logs"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "5994824fa070f19326987053" ON "instagram_message_logs"("vendors__id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "labels__uid_key" ON "labels"("_uid");

-- CreateIndex
CREATE INDEX "labels_vendors__id_idx" ON "labels"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "login_logs__uid_key" ON "login_logs"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "manual_subscriptions__uid_key" ON "manual_subscriptions"("_uid");

-- CreateIndex
CREATE INDEX "manual_subscriptions_vendors__id_idx" ON "manual_subscriptions"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "0b1e2bed40520e86c12ef69c" ON "out_of_office_deliveries"("out_of_office_settings__id", "customer_identifier", "ooo_period_key");

-- CreateIndex
CREATE INDEX "out_of_office_settings_vendors__id_idx" ON "out_of_office_settings"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "c04a563859767508c62686de" ON "out_of_office_settings"("vendors__id", "whatsapp_phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "pages__uid_key" ON "pages"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "pending_registrations_token_key" ON "pending_registrations"("token");

-- CreateIndex
CREATE INDEX "product_images_vendor_id_idx" ON "product_images"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "0d9c83b93aa891819f34af79" ON "product_tags"("product_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_uuid_key" ON "product_variants"("uuid");

-- CreateIndex
CREATE INDEX "product_variants_vendor_id_idx" ON "product_variants"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "644fc66031040a7a8e8f1aeb" ON "product_variants"("product_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_uuid_key" ON "products"("uuid");

-- CreateIndex
CREATE INDEX "products_vendor_id_idx" ON "products"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "a3b8975ab03e0b498bcfddae" ON "products"("catalog_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "11bf169700cbdea7500b3c7b" ON "products"("catalog_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "b503e8bd518fa278ea6bb3cd" ON "products"("vendor_id", "meta_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_uuid_key" ON "reports"("uuid");

-- CreateIndex
CREATE INDEX "reports_vendor_id_idx" ON "reports"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_integrations__uid_key" ON "shopify_integrations"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_integrations_shop_domain_key" ON "shopify_integrations"("shop_domain");

-- CreateIndex
CREATE INDEX "shopify_integrations_vendors__id_idx" ON "shopify_integrations"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_order_notifications__uid_key" ON "shopify_order_notifications"("_uid");

-- CreateIndex
CREATE INDEX "shopify_order_notifications_vendors__id_idx" ON "shopify_order_notifications"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders_shopify_order_id_key" ON "shopify_orders"("shopify_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders__uid_key" ON "shopify_orders"("_uid");

-- CreateIndex
CREATE INDEX "shopify_orders_vendors__id_idx" ON "shopify_orders"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_addons__uid_key" ON "subscription_addons"("_uid");

-- CreateIndex
CREATE INDEX "subscription_addons_vendors__id_idx" ON "subscription_addons"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions__uid_key" ON "subscriptions"("_uid");

-- CreateIndex
CREATE INDEX "subscriptions_vendor_id_idx" ON "subscriptions"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_registry__uid_key" ON "token_registry"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles__uid_key" ON "user_roles"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users__uid_key" ON "users"("_uid");

-- CreateIndex
CREATE INDEX "users_vendors__id_idx" ON "users"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_ai_monthly_invoices__uid_key" ON "vendor_ai_monthly_invoices"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_ai_monthly_invoices_invoice_number_key" ON "vendor_ai_monthly_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "vendor_ai_monthly_invoices_vendors__id_idx" ON "vendor_ai_monthly_invoices"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "dec70e8e79206b4f57ec0a1c" ON "vendor_ai_monthly_invoices"("vendors__id", "billing_period");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_ai_usages__uid_key" ON "vendor_ai_usages"("_uid");

-- CreateIndex
CREATE INDEX "vendor_ai_usages_vendors__id_idx" ON "vendor_ai_usages"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_settings__uid_key" ON "vendor_settings"("_uid");

-- CreateIndex
CREATE INDEX "vendor_settings_vendors__id_idx" ON "vendor_settings"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_users__uid_key" ON "vendor_users"("_uid");

-- CreateIndex
CREATE INDEX "vendor_users_vendors__id_idx" ON "vendor_users"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors__uid_key" ON "vendors"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "9dbac474fe82778ae20932e8" ON "verifications"("users__id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "whalexy_appointment_automation_settings_vendors__id_key" ON "whalexy_appointment_automation_settings"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_automation_settings_vendors__id_idx" ON "whalexy_appointment_automation_settings"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_conversation_states_vendors__id_idx" ON "whalexy_appointment_conversation_states"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "3e5f405a1f28d7e1ae756381" ON "whalexy_appointment_conversation_states"("vendors__id", "contacts__id");

-- CreateIndex
CREATE UNIQUE INDEX "whalexy_appointment_holds_token_key" ON "whalexy_appointment_holds"("token");

-- CreateIndex
CREATE INDEX "whalexy_appointment_holds_vendors__id_idx" ON "whalexy_appointment_holds"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_reminder_deliveries_vendors__id_idx" ON "whalexy_appointment_reminder_deliveries"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "8283871e229a117ca116a579" ON "whalexy_appointment_reminder_deliveries"("appointment_id", "offset_minutes");

-- CreateIndex
CREATE UNIQUE INDEX "whalexy_appointment_resources__uid_key" ON "whalexy_appointment_resources"("_uid");

-- CreateIndex
CREATE INDEX "whalexy_appointment_resources_vendors__id_idx" ON "whalexy_appointment_resources"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_schedule_exceptions_vendors__id_idx" ON "whalexy_appointment_schedule_exceptions"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_schedules_vendors__id_idx" ON "whalexy_appointment_schedules"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_service_resources_vendors__id_idx" ON "whalexy_appointment_service_resources"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "935dcc637b3ae10c4e59acd1" ON "whalexy_appointment_service_resources"("appointment_service_id", "appointment_resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "whalexy_appointment_services__uid_key" ON "whalexy_appointment_services"("_uid");

-- CreateIndex
CREATE INDEX "whalexy_appointment_services_vendors__id_idx" ON "whalexy_appointment_services"("vendors__id");

-- CreateIndex
CREATE INDEX "whalexy_appointment_slot_claims_vendors__id_idx" ON "whalexy_appointment_slot_claims"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "43f4636decbb0f563dc2a13c" ON "whalexy_appointment_slot_claims"("vendors__id", "appointment_resource_id", "slot_start_utc");

-- CreateIndex
CREATE UNIQUE INDEX "whalexy_appointments__uid_key" ON "whalexy_appointments"("_uid");

-- CreateIndex
CREATE INDEX "whalexy_appointments_vendors__id_idx" ON "whalexy_appointments"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "b2e0f215868f553ef7681472" ON "whalexy_appointments"("vendors__id", "idempotency_key");

-- CreateIndex
CREATE INDEX "whatsapp_blue_tick_applications_vendors__id_idx" ON "whatsapp_blue_tick_applications"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "a9d9f1ea94a91f8c27045b1e" ON "whatsapp_blue_tick_applications"("vendors__id", "waba_id", "phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_call_artifacts_vendors__id_idx" ON "whatsapp_call_artifacts"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "d03eada5dc1309de031e6511" ON "whatsapp_call_artifacts"("call_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_call_events_event_key_key" ON "whatsapp_call_events"("event_key");

-- CreateIndex
CREATE INDEX "whatsapp_calling_settings_vendors__id_idx" ON "whatsapp_calling_settings"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "97e31c2a6c3ce2a3b54a2d67" ON "whatsapp_calling_settings"("vendors__id", "phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_calls_meta_call_id_key" ON "whatsapp_calls"("meta_call_id");

-- CreateIndex
CREATE INDEX "whatsapp_calls_vendors__id_idx" ON "whatsapp_calls"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "751f62d7644787be004bfeb4" ON "whatsapp_calls"("vendors__id", "request_id");

-- CreateIndex
CREATE INDEX "whatsapp_flow_launch_settings_vendors__id_idx" ON "whatsapp_flow_launch_settings"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "da82fc1c0a67c5c9051ad7dc" ON "whatsapp_flow_launch_settings"("vendors__id", "flow_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_flow_responses__uid_key" ON "whatsapp_flow_responses"("_uid");

-- CreateIndex
CREATE INDEX "whatsapp_flow_responses_vendors__id_idx" ON "whatsapp_flow_responses"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_message_logs__uid_key" ON "whatsapp_message_logs"("_uid");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_vendors__id_idx" ON "whatsapp_message_logs"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_message_queue__uid_key" ON "whatsapp_message_queue"("_uid");

-- CreateIndex
CREATE INDEX "whatsapp_message_queue_vendors__id_idx" ON "whatsapp_message_queue"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_onboarding_connections_onboarding_id_key" ON "whatsapp_onboarding_connections"("onboarding_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_onboarding_connections_phone_number_id_key" ON "whatsapp_onboarding_connections"("phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_onboarding_connections_vendors__id_idx" ON "whatsapp_onboarding_connections"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "c6d9158d75b4266befe45329" ON "whatsapp_onboarding_connections"("vendors__id", "waba_id", "phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_orders__uid_key" ON "whatsapp_orders"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_orders_order_id_key" ON "whatsapp_orders"("order_id");

-- CreateIndex
CREATE INDEX "whatsapp_orders_vendors__id_idx" ON "whatsapp_orders"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_payments__uid_key" ON "whatsapp_payments"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_payments_payment_id_key" ON "whatsapp_payments"("payment_id");

-- CreateIndex
CREATE INDEX "whatsapp_payments_vendors__id_idx" ON "whatsapp_payments"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates__uid_key" ON "whatsapp_templates"("_uid");

-- CreateIndex
CREATE INDEX "whatsapp_templates_vendors__id_idx" ON "whatsapp_templates"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_user_states__uid_key" ON "whatsapp_user_states"("_uid");

-- CreateIndex
CREATE INDEX "whatsapp_user_states_vendors__id_idx" ON "whatsapp_user_states"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "66a227e73c216a1c9e836ba6" ON "whatsapp_user_states"("vendors__id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_integrations__uid_key" ON "woocommerce_integrations"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_integrations_site_url_key" ON "woocommerce_integrations"("site_url");

-- CreateIndex
CREATE INDEX "woocommerce_integrations_vendors__id_idx" ON "woocommerce_integrations"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_order_notifications__uid_key" ON "woocommerce_order_notifications"("_uid");

-- CreateIndex
CREATE INDEX "woocommerce_order_notifications_vendors__id_idx" ON "woocommerce_order_notifications"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_orders__uid_key" ON "woocommerce_orders"("_uid");

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_orders_woocommerce_order_id_key" ON "woocommerce_orders"("woocommerce_order_id");

-- CreateIndex
CREATE INDEX "woocommerce_orders_vendors__id_idx" ON "woocommerce_orders"("vendors__id");

-- CreateIndex
CREATE UNIQUE INDEX "node_auth_sessions_tokenHash_key" ON "node_auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "node_auth_sessions_userId_idx" ON "node_auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "node_verification_challenges_userId_kind_idx" ON "node_verification_challenges"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "node_outbox_jobs_dedupeKey_key" ON "node_outbox_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "node_outbox_jobs_status_availableAt_idx" ON "node_outbox_jobs"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "node_webhook_receipts_eventKey_key" ON "node_webhook_receipts"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "node_integration_credentials_vendorId_provider_externalId_key" ON "node_integration_credentials"("vendorId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "node_audit_events_vendorId_createdAt_idx" ON "node_audit_events"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "node_api_keys_keyHash_key" ON "node_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "node_api_keys_vendorId_idx" ON "node_api_keys"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "node_memberships_vendorId_userId_key" ON "node_memberships"("vendorId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "node_booking_claims_vendorId_resourceId_slot_key" ON "node_booking_claims"("vendorId", "resourceId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "node_idempotency_vendorId_key_key" ON "node_idempotency"("vendorId", "key");

-- CreateIndex
CREATE INDEX "node_media_vendorId_idx" ON "node_media"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "node_channel_messages_externalMessageId_key" ON "node_channel_messages"("externalMessageId");

-- CreateIndex
CREATE INDEX "node_channel_messages_vendorId_contactId_createdAt_idx" ON "node_channel_messages"("vendorId", "contactId", "createdAt");

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "778a97b70c13529cce24a2ba" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "76b19d356eb33fd5a446ce5c" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "0c2d35a4c3cb7e1b81381432" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "4cb33548a55b88aae0b76cf8" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_label" ADD CONSTRAINT "ccb56e866bc82da3377d2aa6" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_label" ADD CONSTRAINT "e2c2902c2eb287145baa16d3" FOREIGN KEY ("ad_label_id") REFERENCES "ad_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_label" ADD CONSTRAINT "da44f11e84c39f2797b8a81b" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_label" ADD CONSTRAINT "02483ca2de5fb6b918f877df" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_label" ADD CONSTRAINT "a02fd42825f2bfaab73224aa" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_label" ADD CONSTRAINT "b8d56886097dffd22fac50ef" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "5d8d4c7559b7a4970481c71d" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "7609ee64a0330d654df1db2b" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "d17275192aafc202c30fc1b4" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "04dfc5f45bba50e54bb33db3" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "92b3e0c6b1551db4db5f36fb" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "5bd88eff21ddcdbc1eaf85bc" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "9cb7d20ac61aa8cf8d9cadf1" FOREIGN KEY ("ad_set_id") REFERENCES "ad_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "5a6e8d33b96c53cea61748de" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "20a32c320bb6b2d7bb4c8c0a" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "8142451c7c09ff46460c4d8b" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "700a59172d08dbf0254329d1" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_conversation_attributions" ADD CONSTRAINT "8938e9644248226f584d9634" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "9d2b196f74f858c3b9b52c21" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "f0ae22f658a63efaba239f6c" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "6f17724149576ae69eca4de5" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "20d580cc2ac89524c7d5dbb7" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_labels" ADD CONSTRAINT "25c93a9ca2e1c92ba770c93e" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_labels" ADD CONSTRAINT "a7e6523badc7d1e737549c4a" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_labels" ADD CONSTRAINT "a3e3de667ed704d087eeaf21" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_labels" ADD CONSTRAINT "634a086de675b7a14bcae22d" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_notifications" ADD CONSTRAINT "faef6c2ddf3bce8c78cf4107" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_notifications" ADD CONSTRAINT "dd3441fc9a42b2b632f584d4" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_notifications" ADD CONSTRAINT "a0e9bb9de4401985012e9a19" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_notifications" ADD CONSTRAINT "fad7f3d964e595e783462db1" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "963b6d3ce27793300956ef8e" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "0e3901a000a83834016dc31f" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "d302034a1e1a57f87f203d22" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "532dc16378cece5bbd89e341" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "65b2f457436d2ea255d079f6" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "13c631fe176e46ce7be62a81" FOREIGN KEY ("ad_set_id") REFERENCES "ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "a0cce7fe4e9c025f2140aa29" FOREIGN KEY ("ad_creative_id") REFERENCES "ad_creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "14202160994b31a71f92920c" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "2660a2303c952d4a478ecc0a" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "0ea123d705fd6fe39e33508e" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "d4c5a957c1e909991b27b567" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_handoffs" ADD CONSTRAINT "336ffed637baa93f8a002cc7" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_handoffs" ADD CONSTRAINT "d45490551ae2f009cfe49957" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_handoffs" ADD CONSTRAINT "6e998dc8d8782a0b5f4c91a2" FOREIGN KEY ("assigned_users__id") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_handoffs" ADD CONSTRAINT "d55748a51f4e4baf80edc6f7" FOREIGN KEY ("accepted_by_users__id") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_rules" ADD CONSTRAINT "b2fdf7f83523dbffe6a995f9" FOREIGN KEY ("audience_id") REFERENCES "audiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_rules" ADD CONSTRAINT "65bb4f1d0ba07c51b15f2cdd" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_rules" ADD CONSTRAINT "ab13b9cadb98e098ef848634" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_rules" ADD CONSTRAINT "684ebb66567eaf5a1fd6ffe7" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_rules" ADD CONSTRAINT "c6307dd55124082f12c12fd3" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audiences" ADD CONSTRAINT "5d42f3e7fb6da780e36b779a" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audiences" ADD CONSTRAINT "9a118ea5fe85d5249bb0ae93" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audiences" ADD CONSTRAINT "018f512df22a68c1fab0dc30" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audiences" ADD CONSTRAINT "7abe02384bafa52e4a0846c8" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_tag" ADD CONSTRAINT "75dc81d9d04147c96819a106" FOREIGN KEY ("blog_post_id") REFERENCES "blog_posts"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_tag" ADD CONSTRAINT "19f80adde5582b5d35fcd161" FOREIGN KEY ("blog_tag_id") REFERENCES "blog_tags"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "792bf761289b85ef5fbcaf9a" FOREIGN KEY ("author_id") REFERENCES "users"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "7f8477035975ab36b5dd260a" FOREIGN KEY ("category_id") REFERENCES "blog_categories"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "0eea43d8bee7f9f932e884bd" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "952c6d796271318ef63e261b" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "99540ba925175afc76c83c07" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "0ae8234494b5e16c5e198b75" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "e9bde015b41f1bfdd8f163ce" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "3e339d46d892a4e178cf0c68" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "ebeef811bc1a2417d82e790e" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "b3c8725d87516d6d333f84b0" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "73020a9071ec23f1fa5ddf9c" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "85a673308ed5c0108753ce79" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "da00e02cdb891acd4bde69df" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "c202b090d4d5b7b95291d92c" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "3f139a9c57f4e5b67e8a4c6f" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "48da6e4cfacadd2d7dd5fc2d" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "1919a9ebd62a7db77670a551" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "ec594cf5c5a33220a105d80f" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "569c6dfa008329377ea39e86" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "4aae64090c1777f4d1b72477" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "900192b0f46e922561d610b8" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "33fff986d73de87443cb24fa" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "7b88c82b77d5d0d1d48f16c6" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "ab743e6898e1c91e7762dfc5" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "36bfab04ac2aa1f1634d2681" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "e4eceda39d3c5ea1a09394c2" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "515706f58d5ec7888f2c16dc" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "66753851ee3e6466f4c66f4d" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "c00acf6204ca8b501f34b8fa" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "c7280c3f784fe6495b750a26" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "29519777cf959944ecddc1b9" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "e8c0ccda7bd01cce8e779028" FOREIGN KEY ("whatsapp_templates__id") REFERENCES "whatsapp_templates"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_activity_logs" ADD CONSTRAINT "bc028f9b30867be1ae9b99ff" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_activity_logs" ADD CONSTRAINT "601c9ad6c502b3993f6a63dd" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_activity_logs" ADD CONSTRAINT "b5d786eb11da0e833efef5d5" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_activity_logs" ADD CONSTRAINT "bd588b3feb2b31a9948ae189" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_connections" ADD CONSTRAINT "0933d86ec9cd47ab7702e82c" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_connections" ADD CONSTRAINT "1f3ad05559d17a7d0e77f2d4" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_connections" ADD CONSTRAINT "77b3eda2bb13cdc302a0f5c9" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_connections" ADD CONSTRAINT "d77be010d8c9dd2b4fab635b" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_exports" ADD CONSTRAINT "c88f7cf4241c098b5e8d2b99" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_exports" ADD CONSTRAINT "f5fee2281f96dfbd1869efca" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_exports" ADD CONSTRAINT "5843f3eedbf138dd14de37c8" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_exports" ADD CONSTRAINT "88fa134680ff52efa7195763" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_imports" ADD CONSTRAINT "be4dfdadc8021a23985ca54c" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_imports" ADD CONSTRAINT "57601b73ee8cecdf0df255fd" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_imports" ADD CONSTRAINT "c8678bc32bb282eb8dfacf81" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_imports" ADD CONSTRAINT "f8f5333466a526f35309290c" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "8ca26d20bf6e5389e269e958" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "a42ae07a873af8bdc3401202" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "9384b0a6b8322221aecd5571" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_settings" ADD CONSTRAINT "b7011243d596dcce90885180" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_sync_logs" ADD CONSTRAINT "a722a9b7b08cb167b3b38c78" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_sync_logs" ADD CONSTRAINT "56175597605288f8a9810a5d" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_sync_logs" ADD CONSTRAINT "404767591ca872acdd2726c1" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_sync_logs" ADD CONSTRAINT "9981c2012dc260847f1b560b" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "72be336e958f16c6ef9862b0" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "a3416a8abec4519e520c0946" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "7aa5f640dc49b258729ccf06" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "24499a46c342eda6549018be" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "72870bae717c684ef4ecfcfa" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "29e16de05bd24c145c477d5c" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "bbe44e80571ee26e58c0d35a" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "0e8c074dccf667dab063f13e" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "dc8cf2ab4f5fe5881b0ee78c" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "6faccd172866751498742ada" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "ff728fa0f924799b81f763f3" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "52f8d14cb2c64b797d3b7773" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "a0080755dad821626d32de4a" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "abe2581aeedb99169da4d744" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_to_dm_automations" ADD CONSTRAINT "3709c8143028841047b1fec9" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_to_dm_executions" ADD CONSTRAINT "1a5ce868eba949d06f43fc41" FOREIGN KEY ("automation_id") REFERENCES "comment_to_dm_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_to_dm_executions" ADD CONSTRAINT "16b8372ab863e3759e11b60d" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "04435e1804f06fce831cda69" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "97bfb2f671da0660a7817e8d" FOREIGN KEY ("contact_custom_fields__id") REFERENCES "contact_custom_fields"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_groups" ADD CONSTRAINT "48f4a605a25a2bf37d6e7822" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_labels" ADD CONSTRAINT "b2f91ddb52e636bf0b57a6e6" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_labels" ADD CONSTRAINT "843ab5c1bcf6094ed3902881" FOREIGN KEY ("labels__id") REFERENCES "labels"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "2356c5f3285ca71b92653495" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "0bab1c8046f34c00c8247fc6" FOREIGN KEY ("assigned_users__id") REFERENCES "users"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_ai_analysis" ADD CONSTRAINT "f05837753da4cad692095823" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_ai_analysis" ADD CONSTRAINT "53c1133437c965006062a5dc" FOREIGN KEY ("conversation_id") REFERENCES "contacts"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classification_logs" ADD CONSTRAINT "8b507017e8fd12551e99cb17" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classification_logs" ADD CONSTRAINT "e901035bd7ff2a8a931a018d" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classification_tags" ADD CONSTRAINT "78689423cdf9fdde1c0df2aa" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classifications" ADD CONSTRAINT "3191be2487dfd1db968b0468" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classifications" ADD CONSTRAINT "2e88124d2abab210c174fbe8" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_cx_scores" ADD CONSTRAINT "c19ea9900501be24c465a83a" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_cx_scores" ADD CONSTRAINT "4b18e671d6339638bf7c2d44" FOREIGN KEY ("conversation_id") REFERENCES "contacts"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_cx_scores" ADD CONSTRAINT "511b1ba0d197501c2824b45d" FOREIGN KEY ("agent_id") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "b3ae72b439c1897397765513" FOREIGN KEY ("conversion_id") REFERENCES "conversions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "0879693c9efb7909c1641a70" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "673c6c10ec702b3e9369eec8" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "5829c4ae228a4ead2301db6e" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "82da4ab87f0afe2c4c84eff3" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "65b4799b653d219ce0dfbee0" FOREIGN KEY ("ad_campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "f31a4c8c30e1847df4eb68d5" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "5cb90528d4036cf99e62f032" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "601b7e96c695cc33a72367d1" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "c260c33034d0ba92a9075c4b" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "b56161d126d14c1374762b0f" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_assets" ADD CONSTRAINT "27e9d17c9921f18536643650" FOREIGN KEY ("ad_creative_id") REFERENCES "ad_creatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_assets" ADD CONSTRAINT "6e5153bec14d69d5215b4e54" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_assets" ADD CONSTRAINT "2be675a3ad7749bbaa38983e" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_assets" ADD CONSTRAINT "535e465630bae4e59d4edf61" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_assets" ADD CONSTRAINT "4e24b361f7f641198ed6cde8" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_sheet_automations" ADD CONSTRAINT "d3e28e26c4e2342367fc472e" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contacts" ADD CONSTRAINT "801bbc205530e272421c323f" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contacts" ADD CONSTRAINT "ff006018677535c78d7b0973" FOREIGN KEY ("contact_groups__id") REFERENCES "contact_groups"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_message_logs" ADD CONSTRAINT "f93c36461f9d470edab63e05" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instagram_message_logs" ADD CONSTRAINT "61bffb8d8b3b2ddb31ead528" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "out_of_office_deliveries" ADD CONSTRAINT "d0c072bc47f86502835862e9" FOREIGN KEY ("out_of_office_settings__id") REFERENCES "out_of_office_settings"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "out_of_office_schedules" ADD CONSTRAINT "f90f232dcfc036ca9ae3661c" FOREIGN KEY ("out_of_office_settings__id") REFERENCES "out_of_office_settings"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "bce08ab7834fc37545a76682" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "5532d2ecd07896111d89e595" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "c293d3cb6a1707c67919f199" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "29b25739451fe8ba391316de" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "e5efa2c6c96dae466fda6ca9" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "1745d8b6ca6c4cfd0bceae81" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "11ec777a761883aabf0d7b97" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "4d3908b97d6036ad3d3ef9e7" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "db15540b315727aaea0cc3c0" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "c589aa4690b0588e073a3304" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "c861b9ed52a145065e147ecf" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "93c2ffc4608c57a9facd67bf" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "f697d0d1ebfba073f837422d" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "bac63b74b804981d7a3a3ff9" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "6a62051e3f47cdbd12defa12" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "b806507b9de11b02e7538edd" FOREIGN KEY ("organization_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "ecd774606869ead5937d47c2" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "30b71e08a0063a93277fd937" FOREIGN KEY ("created_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "ea05939ac66658c15f07fb4d" FOREIGN KEY ("updated_by") REFERENCES "users"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_integrations" ADD CONSTRAINT "0e2eb7f5b200d28d24a8b3d3" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_order_notifications" ADD CONSTRAINT "5ce853f8828542ebf1b6c4ad" FOREIGN KEY ("shopify_orders__id") REFERENCES "shopify_orders"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_order_notifications" ADD CONSTRAINT "73b1009f0bb869ee5e4ada2c" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_order_notifications" ADD CONSTRAINT "afe48e2c34744802348db85e" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_orders" ADD CONSTRAINT "6b788164796ba5448ad483f3" FOREIGN KEY ("shopify_integrations__id") REFERENCES "shopify_integrations"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_orders" ADD CONSTRAINT "8da4745353b092549735d6bb" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_orders" ADD CONSTRAINT "bd5f038bcf0e9457f10512d4" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "960e829619af9e3c55c0b848" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "eaedc6702fe9ff5b91875546" FOREIGN KEY ("user_roles__id") REFERENCES "user_roles"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settings" ADD CONSTRAINT "1ac852b914503caea9833a5f" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_users" ADD CONSTRAINT "1c30074bf60964ae6344cf4a" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_users" ADD CONSTRAINT "85639474478545fc9b4d1dc4" FOREIGN KEY ("users__id") REFERENCES "users"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_blue_tick_applications" ADD CONSTRAINT "3f007087216a11f8fb5e51d0" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_logs" ADD CONSTRAINT "0b27bc408976e2be47831654" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_logs" ADD CONSTRAINT "e14e0688c21c14202008d785" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_logs" ADD CONSTRAINT "7f43d48e48679d9c2fb7c07d" FOREIGN KEY ("campaigns__id") REFERENCES "campaigns"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_queue" ADD CONSTRAINT "51fccde36eb84f9849e4210c" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_queue" ADD CONSTRAINT "342008aed3391f5771f427c8" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_queue" ADD CONSTRAINT "dbf930932edd394b439e08e3" FOREIGN KEY ("campaigns__id") REFERENCES "campaigns"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_onboarding_connections" ADD CONSTRAINT "011590df33b3e1965fa6233a" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "21c81dac5e404cc64a93d1d8" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_integrations" ADD CONSTRAINT "173a1895e46a0db779352f68" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_order_notifications" ADD CONSTRAINT "f57fbc2ca5577e99840dd349" FOREIGN KEY ("woocommerce_orders__id") REFERENCES "woocommerce_orders"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_order_notifications" ADD CONSTRAINT "430c430a5342dd38730c10b0" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_order_notifications" ADD CONSTRAINT "a84eab23cba0b1061ea4224b" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_order_notifications" ADD CONSTRAINT "d7fb4b049923db1013793f9f" FOREIGN KEY ("whatsapp_templates__id") REFERENCES "whatsapp_templates"("_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_orders" ADD CONSTRAINT "fdb05eba6ad218205d548386" FOREIGN KEY ("woocommerce_integrations__id") REFERENCES "woocommerce_integrations"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_orders" ADD CONSTRAINT "115ac26c50ae373a97ef57b4" FOREIGN KEY ("vendors__id") REFERENCES "vendors"("_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_orders" ADD CONSTRAINT "17522354278f3d5745748ccd" FOREIGN KEY ("contacts__id") REFERENCES "contacts"("_id") ON DELETE SET NULL ON UPDATE CASCADE;
