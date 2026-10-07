import {
  legacyCentralSearchRouter,
  legacyVendorSearchRouter,
} from '../modules/dashboard/legacy-search.routes.js';
import { legacyWhatsappOrdersRouter } from '../modules/whatsapp-orders/whatsapp-orders.routes.js';
import { legacyBlogsRouter } from '../modules/content/legacy-blogs.routes.js';
import { legacyConfigurationRouter } from '../modules/configuration/legacy-configuration.routes.js';
import { legacyPagesRouter } from '../modules/content/legacy-pages.routes.js';
import { legacyBotFlowsRouter } from '../modules/bot-flows/legacy-bot-flows.routes.js';
import { legacyTranslationsRouter } from '../modules/translations/legacy-translations.routes.js';
import { legacyBotRepliesRouter } from '../modules/bot-replies/legacy-bot-replies.routes.js';
import { legacyOutOfOfficeRouter } from '../modules/out-of-office/legacy-out-of-office.routes.js';
import { legacyCampaignRouter } from '../modules/campaigns/legacy-campaign.routes.js';
import { legacyStoreSettingsRouter } from '../modules/store-notifications/legacy-store-settings.routes.js';
import { legacyStoreHistoryRouter } from '../modules/store-orders/legacy-store-history.routes.js';
import { legacyStoreRetryRouter } from '../modules/store-notifications/legacy-store-retry.routes.js';
import { legacyStoreReportsRouter } from '../modules/integrations/legacy-store-reports.routes.js';
import { legacyContactAutomationRouter } from '../modules/contacts/legacy-contact-automation.routes.js';
import {
  legacyChatReadRouter,
  legacyUnreadRouter,
} from '../modules/messaging/legacy-chat-read.routes.js';
import { legacyChatMessageRouter } from '../modules/messaging/legacy-chat-message.routes.js';
import { legacyContactGroupsRouter } from '../modules/contact-workflows/legacy-contact-groups.routes.js';
import { legacyContactMembershipsRouter } from '../modules/contact-workflows/legacy-contact-memberships.routes.js';
import { legacyContactRecordsRouter } from '../modules/contact-workflows/legacy-contact-records.routes.js';
import { legacyContactDirectoryRouter } from '../modules/contact-workflows/legacy-contact-directory.routes.js';
import { legacyContactBulkDeleteRouter } from '../modules/contact-workflows/legacy-contact-bulk-delete.routes.js';
import { legacyContactFieldsRouter } from '../modules/contact-fields/legacy-contact-fields.routes.js';
import { legacyContactProfileRouter } from '../modules/contact-workflows/legacy-contact-profile.routes.js';
import express, { type Express } from 'express';
import { knowledgeRouter } from '../modules/knowledge/knowledge.routes.js';
import { conversationAnalysisRouter } from '../modules/conversation-analysis/conversation-analysis.routes.js';
import { authenticateLegacyWorkspace } from '../middleware/legacy-workspace.js';
import { legacyAppointmentRouter } from '../modules/appointments/legacy-appointment.routes.js';
import { legacyContactRouter } from '../modules/contacts/legacy-contact.routes.js';
import { legacyContactListRouter } from '../modules/contacts/legacy-contact-list.routes.js';
import { legacyMessagingRouter } from '../modules/messaging/legacy-messaging.routes.js';
import { legacyTallyRouter } from '../modules/tally/legacy-tally.routes.js';
import { legacyAdsRouter } from '../modules/ads-manager/legacy-ads.routes.js';
import { authenticate } from '../middleware/auth.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { legacyAuthRouter } from '../modules/auth/legacy-auth.routes.js';
import { projectsRouter } from '../modules/vendors/vendors.routes.js';
import { webhookRouter } from '../modules/webhooks/webhooks.routes.js';
import { publicContentRouter, adminContentRouter } from '../modules/content/content.routes.js';
import { adminBillingRouter } from '../modules/billing/billing.routes.js';
import { jobsRouter } from '../modules/jobs-admin/jobs-admin.routes.js';
import { flowDataWebhookRouter } from '../modules/flow-data/flow-data.routes.js';
import {
  publicTranslationsRouter,
  adminTranslationsRouter,
} from '../modules/translations/translations.routes.js';
import { configurationRouter } from '../modules/configuration/configuration.routes.js';
import { homeRouter } from '../modules/home/home.routes.js';
import { createAuthRateLimit } from '../middleware/rate-limit.js';
import { createVendorRouter } from './vendor.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { legacyClassificationsRouter } from '../modules/classifications/legacy-classifications.routes.js';
import { legacyCxScoresRouter } from '../modules/cx-scores/legacy-cx-scores.routes.js';
import { legacyConversationRouter } from '../modules/contacts/legacy-conversation.routes.js';

export function registerRoutes(app: Express) {
  app.use('/health', healthRouter);
  // Raw-body signed routes MUST precede JSON parsing.
  app.use('/webhooks/flows', flowDataWebhookRouter);
  app.use('/webhooks', webhookRouter);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/central-console/translations', legacyTranslationsRouter);
  app.use('/central-console', legacyCentralSearchRouter);
  app.use('/vendor-console', legacyVendorSearchRouter);
  app.use('/central-console/pages', legacyPagesRouter);
  app.use('/central-console/blogs', legacyBlogsRouter);
  app.use('/central-console/configuration', legacyConfigurationRouter);
  app.use('/vendor-console/settings/out-of-office', legacyOutOfOfficeRouter);
  app.use('/vendor-console/bot-replies/bot-flows', legacyBotFlowsRouter);
  app.use('/vendor-console/bot-replies', legacyBotRepliesRouter);
  app.use('/vendor-console/whatsapp/chat/classification', legacyClassificationsRouter);
  app.use('/vendor-console/cx-analytics', legacyCxScoresRouter);
  app.use('/vendor-console/conversations', legacyConversationRouter);
  app.use('/vendor-console/contacts/custom-fields', legacyContactFieldsRouter);
  app.use('/vendor-console/contacts/groups', legacyContactGroupsRouter);
  app.use('/vendor-console/contacts', legacyContactMembershipsRouter);
  app.use('/vendor-console/contacts', legacyContactRecordsRouter);
  app.use('/vendor-console/contacts', legacyContactDirectoryRouter);
  app.use('/vendor-console/contacts', legacyContactBulkDeleteRouter);
  app.use('/vendor-console/contacts', legacyContactAutomationRouter);
  app.use('/vendor-console/whatsapp/contact', legacyContactProfileRouter);
  app.use('/vendor-console/whatsapp/contact/chat', legacyChatMessageRouter);
  app.use('/vendor-console/whatsapp/contact', legacyChatReadRouter);
  app.use('/vendor-console/whatsapp', legacyUnreadRouter);
  app.use('/vendor-console/whatsapp-orders', legacyWhatsappOrdersRouter);
  app.use('/vendor-console/integration', legacyStoreReportsRouter);
  app.use('/vendor-console/integration', legacyStoreRetryRouter);
  app.use('/vendor-console/integration', legacyStoreHistoryRouter);
  app.use('/vendor-console/integration', legacyStoreSettingsRouter);
  app.use('/vendor-console/whatsapp/campaign', legacyCampaignRouter);
  app.use('/api', legacyAuthRouter);
  app.use('/api/vendor/contact', legacyContactListRouter);
  app.use('/api/:vendorUid/appointments', legacyAppointmentRouter);
  app.use('/api/:vendorUid/contact', legacyContactRouter);
  app.use('/api/:vendorUid/contact', legacyMessagingRouter);
  app.use('/api/:vendorUid/tally', legacyTallyRouter);
  app.use('/api/:vendorUid/ads-manager', legacyAdsRouter);
  app.use('/api/v1/vendor/knowledge', authenticateLegacyWorkspace, knowledgeRouter);
  app.use('/api/ai', authenticateLegacyWorkspace, conversationAnalysisRouter);
  app.use('/api/v1/public', publicContentRouter);
  app.use('/api/v1/public', homeRouter);
  app.use('/api/v1/admin/configuration', configurationRouter);
  app.use('/api/v1/public/translations', publicTranslationsRouter);
  app.use('/api/v1/admin/translations', adminTranslationsRouter);
  app.use('/api/v1/admin/content', adminContentRouter);
  app.use('/api/v1/admin/vendors/:vendorId/billing', adminBillingRouter);
  app.use('/api/v1/admin/jobs', jobsRouter(true));
  app.use('/api/v1/auth', createAuthRateLimit(), authRouter);
  app.use('/api/v1/projects', authenticate, projectsRouter);
  app.use('/api/v1/vendors/:vendorId', createVendorRouter());
}
