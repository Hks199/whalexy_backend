import { type OutboxJobs } from '@prisma/client';
import { ApiError } from '../shared/api-error.js';
import { resumeGraphFlow } from '../modules/bot-flows/services/bot-graph-runtime.js';
import { ingestStoreOrder } from '../modules/store-orders/store-orders.service.js';
import { queueStoreNotification } from '../modules/store-notifications/services/notification-delivery.service.js';
import { ingestStripeEvent } from '../modules/stripe-events/stripe-events.service.js';
import { generateCxScore } from '../modules/cx-scores/cx-scores.service.js';
import { dispatchFollowCheck } from '../modules/comment-automations/services/follow-checks.service.js';
import { dispatchCommentAction } from '../modules/comment-automations/services/comment-delivery.service.js';
import { handleWhatsAppSend } from './handlers/whatsapp-send.handler.js';
import { handleEmailDelivery } from './handlers/email.handler.js';
import { handleMetaWebhook } from './handlers/meta-webhook.handler.js';
import { generateConversationAnalysis } from '../modules/conversation-analysis/services/analysis-worker.service.js';
import { handleRazorpayWebhook } from './handlers/payment-webhook.handler.js';

export async function processJob(job: OutboxJobs) {
  if (job.kind === 'conversation-analysis') {
    await generateConversationAnalysis(job);
    return;
  }
  if (job.kind === 'comment-action') {
    await dispatchCommentAction(job);
    return;
  }
  if (job.kind === 'comment-follow') {
    await dispatchFollowCheck(job);
    return;
  }
  if (job.kind === 'bot-flow-resume') {
    await resumeGraphFlow(job);
    return;
  }
  if (job.kind === 'store-notification') {
    await queueStoreNotification(job);
    return;
  }
  if (job.kind === 'cx-score') {
    await generateCxScore(job);
    return;
  }
  if (job.kind === 'whatsapp-send') {
    await handleWhatsAppSend(job);
    return;
  }
  if (job.kind === 'email') {
    await handleEmailDelivery(job);
    return;
  }
  if (job.kind === 'webhook-meta') {
    await handleMetaWebhook(job);
    return;
  }
  if (job.kind === 'webhook-shopify' || job.kind === 'webhook-woocommerce') {
    await ingestStoreOrder(job);
    return;
  }
  if (job.kind === 'webhook-stripe') {
    await ingestStripeEvent(job);
    return;
  }
  if (job.kind === 'webhook-razorpay') {
    await handleRazorpayWebhook(job);
    return;
  }
  throw new ApiError(503, 'JOB_HANDLER_PENDING', `Handler has not been verified for ${job.kind}`);
}
