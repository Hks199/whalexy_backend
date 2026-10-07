CREATE TABLE "node_meta_flows" (
    "id" TEXT PRIMARY KEY,
    "vendor_id" INTEGER NOT NULL,
    "waba_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "categories" JSONB NOT NULL,
    "flow_json" JSONB,
    "validation_errors" JSONB,
    "endpoint_uri" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "node_meta_flows_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "node_meta_flows_vendor_id_waba_id_idx" ON "node_meta_flows"("vendor_id", "waba_id");
