-- SQLite metadata reconciliation: additions plus data-preserving column renames.
-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "user_role_id" INTEGER;

-- AlterTable
ALTER TABLE "bot_replies" ADD COLUMN     "bot_replies__id" INTEGER;

-- AlterTable
ALTER TABLE "campaign_groups" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "template_language" TEXT,
ADD COLUMN     "template_name" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "users__id" INTEGER;

-- AlterTable
ALTER TABLE "catalog_activity_logs" ADD COLUMN     "subject_id" INTEGER,
ADD COLUMN     "subject_type" TEXT;

-- AlterTable
ALTER TABLE "catalog_sync_logs" ADD COLUMN     "syncable_id" INTEGER,
ADD COLUMN     "syncable_type" TEXT;

-- AlterTable
ALTER TABLE "configurations" ADD COLUMN     "data_type" INTEGER;

-- AlterTable
ALTER TABLE "contact_custom_field_values" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "contact_custom_fields" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "contact_labels" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "phone_verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "countries" ADD COLUMN     "iso3_code" TEXT,
ADD COLUMN     "iso_code" TEXT,
ADD COLUMN     "iso_num_code" INTEGER,
ADD COLUMN     "name_capitalized" TEXT;

-- AlterTable
ALTER TABLE "group_contacts" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "login_logs" ADD COLUMN     "email" TEXT,
ADD COLUMN     "role" INTEGER;

-- AlterTable
ALTER TABLE "manual_subscriptions" ADD COLUMN     "charges" DECIMAL(13,4),
ADD COLUMN     "charges_frequency" TEXT,
ADD COLUMN     "ends_at" TIMESTAMP(3),
ADD COLUMN     "plan_id" TEXT,
ADD COLUMN     "remarks" TEXT;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "image_name" TEXT,
ADD COLUMN     "show_in_menu" INTEGER,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "type" INTEGER,
ADD COLUMN     "vendors__id" INTEGER;

-- AlterTable
ALTER TABLE "user_active_flows" ADD COLUMN     "created_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_roles" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ban_reason" TEXT,
ADD COLUMN     "countries__id" INTEGER,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "profile_picture" TEXT,
ADD COLUMN     "registered_via" TEXT,
ADD COLUMN     "remember_token" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "two_factor_recovery_codes" TEXT,
ADD COLUMN     "two_factor_secret" TEXT,
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "vendor_settings" ADD COLUMN     "status" INTEGER;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "ban_reason" TEXT,
ADD COLUMN     "domain" TEXT,
ADD COLUMN     "favicon" TEXT,
ADD COLUMN     "logo_image" TEXT,
ADD COLUMN     "pm_last_four" TEXT,
ADD COLUMN     "pm_type" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "stripe_id" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "type" INTEGER;

-- AlterTable
ALTER TABLE "whatsapp_message_logs" ADD COLUMN     "is_forwarded" INTEGER,
ADD COLUMN     "messaged_by_users__id" INTEGER;

-- CreateTable
CREATE TABLE "login_attempts" (
    "_id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "message_labels" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "status" INTEGER,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "labels__id" INTEGER NOT NULL,
    "whatsapp_message_logs__id" INTEGER NOT NULL,

    CONSTRAINT "message_labels_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "migration" TEXT NOT NULL,
    "batch" INTEGER NOT NULL,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "_id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "subscription_items" (
    "id" SERIAL NOT NULL,
    "stripe_id" TEXT NOT NULL,
    "stripe_product" TEXT,
    "stripe_price" TEXT NOT NULL,
    "quantity" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "subscription_id" INTEGER NOT NULL,

    CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "status" INTEGER,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "contacts__id" INTEGER NOT NULL,
    "vendors__id" INTEGER NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "priority" TEXT,
    "vendor_users__id" INTEGER,
    "__data" TEXT,
    "assigned_users__id" INTEGER,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "_id" SERIAL NOT NULL,
    "_uid" TEXT NOT NULL,
    "status" INTEGER,
    "updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(13,4),
    "reference_id" TEXT NOT NULL,
    "notes" TEXT,
    "__data" TEXT,
    "vendors__id" INTEGER,
    "subscriptions_id" INTEGER,
    "type" TEXT,
    "manual_subscriptions__id" INTEGER,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("_id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "_id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "key_name" TEXT NOT NULL,
    "value" TEXT,
    "data_type" INTEGER,
    "users__id" INTEGER NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("_id")
);


ALTER TABLE "activity_logs" RENAME COLUMN "users__id" TO "user_id";

ALTER TABLE "activity_logs" RENAME COLUMN "vendors__id" TO "vendor_id";

ALTER TABLE "login_logs" RENAME COLUMN "users__id" TO "user_id";

ALTER TABLE "subscriptions" RENAME COLUMN "vendor_id" TO "vendor_model__id";

ALTER TABLE "users" RENAME COLUMN "phone_number" TO "mobile_number";

ALTER TABLE "whatsapp_message_logs" RENAME COLUMN "whatsapp_message_id" TO "wamid";

ALTER TABLE "whatsapp_templates" RENAME COLUMN "language_code" TO "language";

ALTER INDEX "activity_logs_vendors__id_idx" RENAME TO "activity_logs_vendor_id_idx";
ALTER INDEX "subscriptions_vendor_id_idx" RENAME TO "subscriptions_vendor_model__id_idx";
