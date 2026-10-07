import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import { contactVisibility } from '../../contacts/contacts.service.js';
import { type ServiceContext } from '../../../shared/service-context.js';

export const serializableTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 30000,
};

export const parseContactIdentifier = (value: string) => {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647)
    throw new ApiError(400, 'INVALID_ID', 'Invalid identifier');
  return Number(value);
};

export async function lockedContact(tx: Prisma.TransactionClient, req: ServiceContext) {
  const id = Number(req.params.id);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(601, ${id}::integer)`;
  const contact = await tx.contacts.findFirst({ where: { id, ...contactVisibility(req) } });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return contact;
}

export async function getOwnedContactGroup(
  tx: Prisma.TransactionClient,
  vendorId: number,
  id: number,
) {
  const result = await tx.contactGroups.findFirst({ where: { id, vendorId } });
  if (!result) throw new ApiError(404, 'NOT_FOUND', 'Group not found');
  return result;
}
