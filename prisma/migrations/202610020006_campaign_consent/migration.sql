ALTER TABLE "contacts" ADD COLUMN "whatsapp_opt_out" INTEGER;
ALTER TABLE "contacts" ADD CONSTRAINT "node_contacts_opt_out_check" CHECK ("whatsapp_opt_out" IS NULL OR "whatsapp_opt_out" = 1);
CREATE INDEX "node_campaign_dispatch_idx" ON "whatsapp_message_queue" ("campaigns__id", "status", "_id");
