import { Prisma } from '@prisma/client';
import { db } from '../../database/client.js';

export async function once(
  key: string,
  provider: string,
  payload: Prisma.InputJsonValue,
  work: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  try {
    await db.$transaction(async (tx) => {
      await tx.webhookReceipts.create({ data: { provider, eventKey: key, payload } });
      await work(tx);
      await tx.webhookReceipts.update({
        where: { eventKey: key },
        data: { processedAt: new Date() },
      });
    });
  } catch (e) {
    if (!(
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      (await db.webhookReceipts.findUnique({ where: { eventKey: key } }))
    ))
      throw e;
  }
}
