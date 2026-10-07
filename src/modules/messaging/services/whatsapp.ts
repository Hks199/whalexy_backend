import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';

/** A business/recipient-specific incoming message opens the service window; outgoing activity does not. */
export async function customerWindowOpen(
  vendorId: number,
  contactId: number,
  phoneNumberId: string,
  recipient: string,
  at = new Date(),
  client: Prisma.TransactionClient = db,
) {
  return !!(await client.whatsappMessageLogs.findFirst({
    where: {
      vendorId,
      contactId,
      wabPhoneNumberId: phoneNumberId,
      contactWaId: recipient,
      isIncomingMessage: true,
      OR: [{ type: null }, { type: { not: 'reaction' } }],
      messagedAt: { gt: new Date(at.getTime() - 24 * 3600000), lte: at },
    },
    select: { id: true },
  }));
}
