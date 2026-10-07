import { db } from '../../database/client.js';
import { contactVisibility } from '../contacts/contacts.service.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function getDashboardSummary(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!,
    contacts = await db.contacts.findMany({
      where: contactVisibility(requestInput),
      select: { id: true },
    }),
    ids = contacts.map((c) => c.id);
  const [messages, orders, appointments] = await Promise.all([
    db.whatsappMessageLogs.groupBy({
      by: ['status', 'isIncomingMessage'],
      where: { vendorId, contactId: { in: ids } },
      _count: { _all: true },
    }),
    db.whatsappOrders.count({ where: { vendorId, contactId: { in: ids } } }),
    db.whalexyAppointments.count({
      where: { vendorId, contactId: { in: ids }, status: 'confirmed' },
    }),
  ]);
  return serviceResult(
    { contacts: ids.length, messages, orders, appointments },
    { status: 200, format: 'json' },
  );
}
