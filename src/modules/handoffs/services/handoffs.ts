import { Prisma, type Contacts } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';

export async function eligibleGraphAgent(
  tx: Prisma.TransactionClient,
  vendorId: number,
  uid: string,
) {
  const user = await tx.users.findFirst({ where: { uid, status: 1 }, select: { id: true } });
  const membership = user
    ? await tx.nativeMemberships.findUnique({
        where: { vendorId_userId: { vendorId, userId: user.id } },
      })
    : null;
  if (
    !user ||
    !membership?.active ||
    !Array.isArray(membership.permissions) ||
    !membership.permissions.some((p) => p === '*' || p === 'vendor.chats.reply')
  )
    throw new ApiError(
      409,
      'GRAPH_AGENT_UNAVAILABLE',
      'Assigned team member is unavailable in this business',
    );
  return user.id;
}
export type Escalation = {
  reason: string;
  severity: string;
};
/** Source escalation rules; message contents are never logged. */
export function detectEscalation(message: string): Escalation | null {
  const text = message.trim().toLowerCase().replace(/\s+/gu, ' ');
  if (
    [
      /\b(?:otp|one[ -]?time password)\s*(?:is|hai|:|=|-)\s*\d{4,8}\b/u,
      /\b(?:cvv|cvc)\s*(?:is|hai|:|=|-)\s*\d{3,4}\b/u,
      /\b(?:pin|passcode|password)\s*(?:is|hai|:|=|-)\s*[^\s]{3,}\b/u,
      /\b(?:card|credit card|debit card)\s*(?:number|no\.?|is|:|=|-)*\s*(?:\d[ -]?){12,19}\b/u,
    ].some((pattern) => pattern.test(text))
  )
    return { reason: 'sensitive_information', severity: 'critical' };
  if (
    [
      /\b(?:send|share|bhej|bhejo|bhejiye|de do|dijiye)\b.{0,30}\b(?:payment\s*)?qr\b/u,
      /\b(?:payment\s*)?qr\b.{0,30}\b(?:send|share|bhej|bhejo|bhejiye|karo|kar do|de do|dijiye)\b/u,
      /(?:क्यू\s*आर|क्यूआर|पेमेंट\s*क्यूआर).{0,30}(?:भेजो|भेजिए|भेज दीजिए|दे दो|शेयर)/u,
      /(?:भेजो|भेजिए|भेज दीजिए|दे दो|शेयर).{0,30}(?:क्यू\s*आर|क्यूआर|पेमेंट\s*क्यूआर)/u,
    ].some((pattern) => pattern.test(text))
  )
    return { reason: 'payment_qr_request', severity: 'critical' };
  if (
    /\b(?:fraud|scam|hacked|hack ho gaya|unauthori[sz]ed|chargeback|stolen card|account compromised)\b/u.test(
      text,
    ) ||
    /(?:धोखा|फ्रॉड|अकाउंट हैक|खाता हैक|बिना अनुमति)/u.test(text)
  )
    return { reason: 'security_or_fraud', severity: 'critical' };
  if (
    [
      /\b(?:human|real person|live agent|support agent|customer care|representative|manager)\b/u,
      /\b(?:agent|executive|insaan|aadmi|person)\s+(?:se\s+)?(?:baat|connect|chat)\b/u,
      /\b(?:kisi|customer care)\s+se\s+baat\b/u,
      /(?:एजेंट|इंसान|मैनेजर|कस्टमर केयर).{0,20}(?:बात|कनेक्ट)/u,
    ].some((pattern) => pattern.test(text))
  )
    return { reason: 'human_requested', severity: 'high' };
  return null;
}
export async function requestHandoff(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  escalation: Escalation,
  at = new Date(),
  preferredUserId?: number,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(610, ${contact.vendorId}::integer)`;
  const memberships = await tx.nativeMemberships.findMany({
    where: { vendorId: contact.vendorId, active: true },
  });
  const ids = memberships
    .filter(
      (m) =>
        Array.isArray(m.permissions) &&
        m.permissions.some((p) => p === '*' || p === 'vendor.chats.reply'),
    )
    .map((m) => m.userId);
  const users = await tx.users.findMany({
    where: { id: { in: ids }, status: 1 },
    select: { id: true },
  });
  const eligible = users.map((u) => u.id),
    loads = eligible.length
      ? await tx.contacts.groupBy({
          by: ['assignedUserId'],
          where: { vendorId: contact.vendorId, assignedUserId: { in: eligible } },
          _count: { _all: true },
        })
      : [];
  if (preferredUserId && !eligible.includes(preferredUserId))
    throw new ApiError(
      409,
      'GRAPH_AGENT_UNAVAILABLE',
      'Assigned team member lost messaging access',
    );
  const assignedUserId =
    preferredUserId ??
    (contact.assignedUserId && eligible.includes(contact.assignedUserId)
      ? contact.assignedUserId
      : (eligible.sort(
          (a, b) =>
            (loads.find((l) => l.assignedUserId === a)?._count._all ?? 0) -
              (loads.find((l) => l.assignedUserId === b)?._count._all ?? 0) || a - b,
        )[0] ?? null));
  const openKey = `${contact.vendorId}:${contact.id}`,
    previous = await tx.aiConversationHandoffs.findUnique({ where: { openKey } });
  await tx.contacts.update({
    where: { id: contact.id },
    data: { disableAiBot: 1, assignedUserId, updatedAt: at },
  });
  const handoff = await tx.aiConversationHandoffs.upsert({
    where: { openKey },
    create: {
      vendorId: contact.vendorId,
      contactId: contact.id,
      openKey,
      assignedUserId,
      assignedAt: assignedUserId ? at : null,
      reason: escalation.reason,
      severity: escalation.severity,
      requestedAt: at,
    },
    update: {
      assignedUserId,
      assignedAt: assignedUserId ? at : null,
      status: 'waiting',
      acceptedByUsersId: null,
      acceptedAt: null,
      reason: escalation.reason,
      severity: previous?.severity === 'critical' ? 'critical' : escalation.severity,
      requestedAt: at,
      updatedAt: at,
    },
  });
  return { handoff, created: !previous };
}
export async function acceptHandoff(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contactId: number,
  userId: number,
) {
  const membership = await tx.nativeMemberships.findUnique({
    where: { vendorId_userId: { vendorId, userId } },
  });
  if (
    !membership?.active ||
    !Array.isArray(membership.permissions) ||
    !membership.permissions.some((p) => p === '*' || p === 'vendor.chats.reply') ||
    !(await tx.users.findFirst({ where: { id: userId, status: 1 } }))
  )
    return false;
  const changed = await tx.aiConversationHandoffs.updateMany({
    where: { vendorId, contactId, status: 'waiting' },
    data: {
      status: 'accepted',
      assignedUserId: userId,
      acceptedByUsersId: userId,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  if (changed.count)
    await tx.contacts.updateMany({
      where: { id: contactId, vendorId },
      data: { assignedUserId: userId, updatedAt: new Date() },
    });
  return !!changed.count;
}
export async function resolveHandoff(
  tx: Prisma.TransactionClient,
  vendorId: number,
  contactId: number,
) {
  return tx.aiConversationHandoffs.updateMany({
    where: { vendorId, contactId, status: { in: ['waiting', 'accepted'] } },
    data: { status: 'resolved', openKey: null, resolvedAt: new Date(), updatedAt: new Date() },
  });
}
