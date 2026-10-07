-- Source-model fields missing from the reconstructed base schema. Original SQL still needs reconciliation.
ALTER TABLE "bot_replies" ADD COLUMN "name" TEXT;
CREATE INDEX "node_bot_reply_dispatch_idx" ON "bot_replies" ("vendors__id", "status", "priority_index");
ALTER TABLE "user_active_flows" ADD COLUMN "user_id" INTEGER, ADD COLUMN "flow_id" INTEGER,
  ADD COLUMN "phone_number" TEXT, ADD COLUMN "activated_at" TIMESTAMP(3);
CREATE INDEX "node_active_flow_participant_idx" ON "user_active_flows" ("phone_number", "flow_id");
