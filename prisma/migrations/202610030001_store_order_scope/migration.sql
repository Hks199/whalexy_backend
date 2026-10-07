-- Provider order identifiers belong to a store. Existing rows are retained.
CREATE UNIQUE INDEX "node_shopify_store_order_key" ON "shopify_orders"("shopify_integrations__id", "shopify_order_id");
CREATE UNIQUE INDEX "node_woocommerce_store_order_key" ON "woocommerce_orders"("woocommerce_integrations__id", "woocommerce_order_id");
DROP INDEX "shopify_orders_shopify_order_id_key";
DROP INDEX "woocommerce_orders_woocommerce_order_id_key";
