import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { baseSubscriptionActive } from '../billing/services/billing-support.service.js';
import { readSiteSettings } from '../configuration/services/site-settings.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function getWorkspaceGuide(requestInput: ServiceContext) {
  if (requestInput.identity!.apiKeyId || requestInput.identity!.role !== 'owner')
    throw new ApiError(403, 'FORBIDDEN', 'Workspace owner session required');
  const vendorId = requestInput.identity!.vendorId!;
  const result = await db.$transaction(
    async (tx) => {
      const { settings } = await readSiteSettings(['contact_email'], tx);
      const [
        connections,
        credentials,
        template,
        contact,
        campaign,
        message,
        reply,
        flow,
        activePlan,
      ] = await Promise.all([
        tx.whatsappOnboardingConnections.findMany({
          where: { vendorId, status: 'CONNECTED' },
          select: { phoneNumberId: true, wabaId: true },
        }),
        tx.integrationCredentials.findMany({
          where: { vendorId, provider: 'whatsapp' },
          select: { externalId: true, metadata: true },
        }),
        tx.whatsappTemplates.findFirst({
          where: { vendorId, status: 'APPROVED' },
          select: { id: true },
        }),
        tx.contacts.findFirst({ where: { vendorId, status: 1 }, select: { id: true } }),
        tx.campaigns.findFirst({
          where: {
            vendorId,
            status: { in: ['running', 'dispatching', 'completed', 'completed_with_errors'] },
          },
          select: { id: true },
        }),
        tx.whatsappMessageLogs.findFirst({
          where: {
            vendorId,
            isIncomingMessage: false,
            status: { in: ['sent', 'delivered', 'read'] },
          },
          select: { id: true },
        }),
        tx.botReplies.findFirst({
          where: { vendorId, status: 1, botFlowsId: null },
          select: { id: true },
        }),
        tx.botFlows.findFirst({
          where: { vendorId, status: 'active', data: { path: ['nativeGraphVersion'], equals: 1 } },
          select: { id: true },
        }),
        baseSubscriptionActive(vendorId, new Date(), tx),
      ]);
      const connected = connections.some((connection) =>
        credentials.some(
          (credential) =>
            credential.externalId === connection.phoneNumberId &&
            (credential.metadata as any)?.wabaId === connection.wabaId,
        ),
      );
      return {
        checklist: [
          { id: 'workspace', label: 'Create your workspace', done: true },
          { id: 'whatsapp', label: 'Connect WhatsApp', done: connected },
          { id: 'template', label: 'Create your first template', done: Boolean(template) },
          { id: 'contacts', label: 'Add contacts', done: Boolean(contact) },
          { id: 'campaign', label: 'Send your first campaign', done: Boolean(campaign || message) },
          { id: 'automation', label: 'Create your first automation', done: Boolean(reply || flow) },
        ],
        showSubscriptionOffer: !activePlan,
        demoContactEmail: settings.contact_email || null,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
