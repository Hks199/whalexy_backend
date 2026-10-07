-- A provider account may belong to only one business, including during concurrent onboarding.
CREATE UNIQUE INDEX "node_integration_credentials_provider_externalId_key"
ON "node_integration_credentials"("provider", "externalId");
