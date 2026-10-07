import type { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { baseSubscriptionActive } from '../../billing/services/billing-support.service.js';

export async function aiEntitlementActive(vendorId: number, client: Prisma.TransactionClient = db) {
  return (
    Boolean(
      await client.subscriptionAddons.findFirst({
        where: {
          vendorId,
          addonCode: 'ai_replies',
          source: { in: ['paid', 'admin_override'] },
          status: 'active',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      }),
    ) && (await baseSubscriptionActive(vendorId, new Date(), client))
  );
}
