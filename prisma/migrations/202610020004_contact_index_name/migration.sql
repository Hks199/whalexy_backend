-- PostgreSQL truncates raw identifiers differently from Prisma's generated index name.
ALTER INDEX "contact_custom_field_values_contacts__id_contact_custom_fields_"
RENAME TO "contact_custom_field_values_contacts__id_contact_custom_fie_key";
