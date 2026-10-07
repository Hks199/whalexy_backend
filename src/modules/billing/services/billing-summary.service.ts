import { db } from '../../../database/client.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { baseSubscriptionActive } from './billing-support.service.js';

export async function getBillingSummary(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    at = new Date();
  const [subscriptions, manual, addons, active] = await Promise.all([
    db.subscriptions.findMany({
      where: { vendorId },
      select: {
        id: true,
        type: true,
        stripeStatus: true,
        stripePrice: true,
        quantity: true,
        endsAt: true,
        trialEndsAt: true,
      },
    }),
    db.manualSubscriptions.findMany({
      where: { vendorId },
      select: { id: true, planId: true, status: true, endsAt: true },
    }),
    db.subscriptionAddons.findMany({
      where: { vendorId },
      select: { id: true, addonCode: true, source: true, status: true, expiresAt: true },
    }),
    baseSubscriptionActive(vendorId, at),
  ]);
  return serviceResult(
    { baseSubscriptionActive: active, subscriptions, manual, addons },
    { status: 200, format: 'json' },
  );
}
