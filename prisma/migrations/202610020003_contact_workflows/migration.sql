ALTER TABLE "contacts" ADD COLUMN "language_code" TEXT;
ALTER TABLE "labels" ADD COLUMN "text_color" TEXT, ADD COLUMN "bg_color" TEXT, ADD COLUMN "status" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "contact_custom_fields" ALTER COLUMN "name" DROP NOT NULL;
CREATE UNIQUE INDEX "group_contacts_contacts__id_contact_groups__id_key" ON "group_contacts"("contacts__id", "contact_groups__id");
CREATE UNIQUE INDEX "contact_labels_contacts__id_labels__id_key" ON "contact_labels"("contacts__id", "labels__id");
CREATE UNIQUE INDEX "contact_custom_field_values_contacts__id_contact_custom_fields__id_key" ON "contact_custom_field_values"("contacts__id", "contact_custom_fields__id");
