ALTER TABLE "whatsapp_message_logs" ADD COLUMN "contact_wa_id" TEXT;
-- Recover only identities evidenced by raw incoming messages, without guessing from mutable contacts.
UPDATE "whatsapp_message_logs"
SET "contact_wa_id" = "__data" #>> '{incoming,from}'
WHERE "is_incoming_message" = true AND jsonb_typeof("__data" #> '{incoming,from}') = 'string';
CREATE INDEX "node_whatsapp_customer_window_idx" ON "whatsapp_message_logs"
("vendors__id", "contacts__id", "wab_phone_number_id", "contact_wa_id", "is_incoming_message", "messaged_at");
