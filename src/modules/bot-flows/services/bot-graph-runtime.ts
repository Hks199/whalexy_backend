import {
  Prisma,
  type Contacts,
  type BotFlows,
  type UserActiveFlows,
  type OutboxJobs,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../../../shared/api-error.js';
import { advanceGraph } from './graph-execution.service.js';
import { validateGraph } from './graph-schema.validation.js';
import { type GraphState, type GraphResult } from './graph-types.types.js';
import { eligibleGraphAgent, requestHandoff } from '../../handoffs/services/handoffs.js';
import { db } from '../../../database/client.js';
import { graphTimingAllowed } from './bot-timing.js';
import { graphAwayActive } from '../../out-of-office/out-of-office.service.js';
import { prepareGraphTemplates } from './bot-template.js';
import { prepareGraphCatalogs } from './bot-catalog.js';
import { prepareGraphMetaFlows } from './bot-meta-flow.js';
import { digest } from '../../../utils/crypto.js';
import { graphQuestionFields } from './bot-question.js';

/** The caller holds the inbound participant lock and webhook receipt transaction. */
export async function queueGraphFlow(
  tx: Prisma.TransactionClient,
  contact: Contacts,
  phoneId: string,
  incomingId: string,
  text: string,
  selection: string | undefined,
  matches: (type: string, pattern: string) => boolean,
  allowed: (type: string) => boolean,
  at: Date,
) {
  if (
    contact.status !== 1 ||
    (contact.platform && contact.platform !== 'whatsapp') ||
    (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== phoneId)
  )
    return false;
  const key = `node:whatsapp:${contact.vendorId}:${phoneId}:${contact.id}`;
  const session = await tx.userActiveFlows.findFirst({
    where: { phoneNumber: key },
    orderBy: { id: 'desc' },
  });
  let flow = session?.flowId
    ? await tx.botFlows.findFirst({
        where: { id: session.flowId, vendorId: contact.vendorId, status: 'active' },
      })
    : null;
  const expiryBase = Math.max(
    session?.activatedAt?.getTime() ?? 0,
    Date.parse((session?.data as any)?.delay?.dueAt ?? '') || 0,
  );
  if (
    session &&
    (!flow ||
      (session.data as any)?.revision !== flow.updatedAt.toISOString() ||
      !session.activatedAt ||
      expiryBase < at.getTime() - 24 * 3600000)
  ) {
    await tx.userActiveFlows.delete({ where: { id: session.id } });
    flow = null;
  }
  const validSession = !!flow;
  if (!flow && selection) return false;
  if (!flow) {
    const candidates = await tx.botFlows.findMany({
      where: { vendorId: contact.vendorId, status: 'active' },
      orderBy: { id: 'asc' },
      take: 101,
    });
    flow =
      candidates.find(
        (f) =>
          (f.data as any)?.nativeGraphVersion === 1 &&
          (f.data as any)?.phoneNumberId === phoneId &&
          allowed(f.triggerType) &&
          (['welcome', 'new_message'].includes(f.triggerType)
            ? ['']
            : (f.startTrigger ?? '').split(',').slice(0, 20)
          ).some((p) => matches(f.triggerType, p)),
      ) ?? null;
  }
  if (!flow) return false;
  const data = flow.data as any;
  if (
    data?.nativeGraphVersion !== 1 ||
    data.phoneNumberId !== phoneId ||
    !allowed(flow.triggerType)
  )
    return true;
  const initial = {
    first_name: contact.firstName ?? '',
    last_name: contact.lastName ?? '',
    full_name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    phone_number: contact.waId ?? '',
    email: contact.email ?? '',
  };
  const restart =
    !selection &&
    !['welcome', 'new_message'].includes(flow.triggerType) &&
    (flow.startTrigger ?? '')
      .split(',')
      .slice(0, 20)
      .some((p) => matches(flow!.triggerType, p));
  if (validSession && (session!.data as any)?.delay && !restart) return true;
  const previous = validSession && !restart ? ((session!.data as any)?.state as GraphState) : null;
  const selectionEntry =
    selection && validSession ? (session!.data as any)?.selections?.[selection] : undefined;
  const resolvedSelection =
    typeof selectionEntry === 'string' ? selectionEntry : selectionEntry?.choiceId;
  if (selection && typeof resolvedSelection !== 'string') return true;
  let result;
  let answeredField:
    | {
        id: number;
        value: string;
      }
    | undefined;
  try {
    const graph = validateGraph(data.graph, true);
    const fields = await graphQuestionFields(tx, contact.vendorId, graph);
    for (const node of graph.nodes.filter((n) => n.type === 'team_assignment'))
      await eligibleGraphAgent(tx, contact.vendorId, node.payload.assigned_team_member);
    const waiting = previous?.waiting
      ? graph.nodes.find((n) => n.id === previous.nodeId)
      : undefined;
    result = advanceGraph(
      graph,
      previous,
      {
        ...(selection
          ? { selection: resolvedSelection, selectionNodeId: selectionEntry?.nodeId }
          : { text }),
        fieldType: waiting ? fields.get(waiting.id)?.inputType : undefined,
      },
      initial,
    );
    if (waiting && fields.has(waiting.id) && !selection && result.state !== previous)
      answeredField = { id: fields.get(waiting.id)!.id, value: text.trim() };
    result = await prepareGraphTemplates(
      tx,
      contact,
      phoneId,
      result,
      answeredField ? new Map([[answeredField.id, answeredField.value]]) : undefined,
    );
    result = await prepareGraphCatalogs(tx, contact, phoneId, result);
    result = await prepareGraphMetaFlows(tx, contact, phoneId, result);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await tx.outboxJobs.create({
      data: {
        vendorId: contact.vendorId,
        kind: 'bot-flow-blocked',
        status: 'blocked',
        lastError: error.code,
        dedupeKey: `graph-blocked:${incomingId}:${flow.id}`,
        payload: { flowId: flow.id, contactId: contact.id },
      },
    });
    return true;
  }
  if (answeredField) {
    await tx.contactCustomFieldValues.upsert({
      where: {
        contactId_contactCustomFieldsId: {
          contactId: contact.id,
          contactCustomFieldsId: answeredField.id,
        },
      },
      create: {
        contactId: contact.id,
        contactCustomFieldsId: answeredField.id,
        fieldValue: answeredField.value,
      },
      update: { fieldValue: answeredField.value, updatedAt: at },
    });
    await tx.auditEvents.create({
      data: {
        vendorId: contact.vendorId,
        action: 'update',
        resource: 'contact-custom-value',
        resourceId: String(contact.id),
        metadata: { fieldId: answeredField.id, flowId: flow.id },
      },
    });
  }
  if ((restart || result.resetSelections) && validSession)
    await tx.whatsappMessageLogs.updateMany({
      where: {
        vendorId: contact.vendorId,
        contactId: contact.id,
        wabPhoneNumberId: phoneId,
        status: 'queued',
        whatsappMessageId: null,
        data: { path: ['botFlowId'], equals: flow.id },
      },
      data: { status: 'cancelled', updatedAt: at },
    });
  await commitGraphStep(
    tx,
    flow,
    contact,
    phoneId,
    incomingId,
    { ...result, resetSelections: restart || result.resetSelections },
    validSession ? session : null,
    at,
  );
  return true;
}
async function commitGraphStep(
  tx: Prisma.TransactionClient,
  flow: BotFlows,
  contact: Contacts,
  phoneId: string,
  eventId: string,
  result: GraphResult,
  session: UserActiveFlows | null,
  at: Date,
) {
  const key = `node:whatsapp:${contact.vendorId}:${phoneId}:${contact.id}`;
  let handoffAckId: number | undefined, graphAssignedUserId: number | undefined;
  if (result.assignment) {
    graphAssignedUserId = await eligibleGraphAgent(tx, contact.vendorId, result.assignment.userUid);
    const handoff = await requestHandoff(
      tx,
      contact,
      { reason: 'bot_flow_team_assignment', severity: 'normal' },
      at,
      graphAssignedUserId,
    );
    handoffAckId = handoff.handoff.id;
    await tx.auditEvents.create({
      data: {
        vendorId: contact.vendorId,
        action: 'assign',
        resource: 'bot-flow-handoff',
        resourceId: String(handoffAckId),
        metadata: { flowId: flow.id, userId: graphAssignedUserId },
      },
    });
  }
  const selections: Record<string, any> = result.resetSelections
    ? {}
    : { ...(session?.data as any)?.selections };
  for (const [index, message] of result.messages.entries()) {
    const { nodeId, nativeGraphTemplate, nativeCatalog, nativeFlow, flowToken, ...content } =
        message,
      metadata = {
        botFlowId: flow.id,
        botFlowRevision: flow.updatedAt.toISOString(),
        graphNodeId: nodeId,
        ...(nativeGraphTemplate ? { nativeGraphTemplate } : {}),
        ...(nativeCatalog ? { nativeCatalog } : {}),
        ...(nativeFlow ? { nativeFlow } : {}),
        ...(handoffAckId ? { handoffAckId, graphAssignedUserId } : {}),
      };
    if (['button', 'list'].includes(content.interactive?.type)) {
      const action = content.interactive.action;
      const choices = action.buttons
        ? action.buttons.map((b: any) => b.reply)
        : action.sections.flatMap((s: any) => s.rows);
      for (const [token, entry] of Object.entries(selections))
        if (entry?.nodeId === nodeId) delete selections[token];
      for (const choice of choices) {
        const token = randomUUID();
        selections[token] = { choiceId: choice.id, nodeId };
        choice.id = token;
      }
    }
    const log = await tx.whatsappMessageLogs.create({
      data: {
        vendorId: contact.vendorId,
        contactId: contact.id,
        contactWaId: contact.waId,
        wabPhoneNumberId: phoneId,
        message:
          content.text?.body ??
          content.interactive?.body.text ??
          content[content.type]?.caption ??
          null,
        type: content.type,
        status: 'queued',
        isIncomingMessage: false,
        messagedAt: at,
        data: metadata,
      },
    });
    if (flowToken)
      await tx.nativeIdempotency.create({
        data: {
          vendorId: contact.vendorId,
          key: `flow-token:${digest(flowToken)}`,
          requestHash: digest(`${nativeFlow.id}:${contact.id}`),
          response: {
            messageId: log.id,
            flowId: nativeFlow.id,
            revision: nativeFlow.revision,
            contactId: contact.id,
            recipientWaId: contact.waId,
            phoneNumberId: phoneId,
            expiresAt: at.getTime() + 86400000,
            graphFlowId: flow.id,
            graphFlowRevision: flow.updatedAt.toISOString(),
            credentialId: nativeFlow.credentialId,
            credentialRevision: nativeFlow.credentialRevision,
          },
        },
      });
    await tx.outboxJobs.create({
      data: {
        vendorId: contact.vendorId,
        kind: 'whatsapp-send',
        dedupeKey: `graph:${eventId}:${flow.id}:${index}`,
        payload: {
          ...metadata,
          messageId: log.id,
          phoneNumberId: phoneId,
          payload: { messaging_product: 'whatsapp', to: contact.waId, ...content },
        },
      },
    });
  }
  if (result.state.nodeId) {
    const delay = result.delay
      ? {
          token: randomUUID(),
          dueAt: new Date(at.getTime() + result.delay.seconds * 1000).toISOString(),
          nextNodeId: result.delay.nextNodeId,
        }
      : undefined;
    const stateData = {
      revision: flow.updatedAt.toISOString(),
      state: result.state,
      selections,
      ...(delay ? { delay } : {}),
    } as unknown as Prisma.InputJsonObject;
    const saved = session
      ? await tx.userActiveFlows.update({
          where: { id: session.id },
          data: { currentNodeUid: result.state.nodeId, data: stateData, updatedAt: at },
        })
      : await tx.userActiveFlows.create({
          data: {
            phoneNumber: key,
            flowId: flow.id,
            activatedAt: at,
            currentNodeUid: result.state.nodeId,
            data: stateData,
            createdAt: at,
            updatedAt: at,
          },
        });
    if (delay)
      await tx.outboxJobs.create({
        data: {
          vendorId: contact.vendorId,
          kind: 'bot-flow-resume',
          dedupeKey: `graph-resume:${delay.token}`,
          availableAt: new Date(delay.dueAt),
          payload: {
            sessionId: saved.id,
            flowId: flow.id,
            flowRevision: flow.updatedAt.toISOString(),
            contactId: contact.id,
            recipientWaId: contact.waId,
            phoneNumberId: phoneId,
            delayToken: delay.token,
          },
        },
      });
  } else if (session) await tx.userActiveFlows.delete({ where: { id: session.id } });
}
export async function resumeGraphFlow(job: OutboxJobs, at = new Date()) {
  const payload = job.payload as any;
  await db.$transaction(async (tx) => {
    const contact = await tx.contacts.findFirst({
      where: { id: payload.contactId, vendorId: job.vendorId! },
    });
    if (!contact?.waId) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${contact.vendorId}:whatsapp:${contact.waId}`},0))`;
    const receiptKey = `graph-resume:${job.id}`;
    if (await tx.webhookReceipts.findUnique({ where: { eventKey: receiptKey } })) return;
    const session = await tx.userActiveFlows.findFirst({
      where: {
        id: payload.sessionId,
        flowId: payload.flowId,
        phoneNumber: `node:whatsapp:${contact.vendorId}:${payload.phoneNumberId}:${contact.id}`,
      },
    });
    const data = session?.data as any,
      delay = data?.delay;
    if (
      !session ||
      !delay ||
      delay.token !== payload.delayToken ||
      data.revision !== payload.flowRevision
    )
      return;
    const due = Date.parse(delay.dueAt);
    if (!Number.isFinite(due))
      throw new ApiError(409, 'GRAPH_STATE_INVALID', 'Invalid delay state');
    if (due > at.getTime()) throw new ApiError(409, 'GRAPH_DELAY_NOT_DUE', 'Delay has not elapsed');
    const [flow, business, handoff] = await Promise.all([
      tx.botFlows.findFirst({
        where: { id: payload.flowId, vendorId: contact.vendorId, status: 'active' },
      }),
      tx.vendors.findUnique({ where: { id: contact.vendorId }, select: { status: true } }),
      tx.aiConversationHandoffs.findFirst({
        where: {
          vendorId: contact.vendorId,
          contactId: contact.id,
          status: { in: ['waiting', 'accepted'] },
        },
        select: { id: true },
      }),
    ]);
    if (
      !flow ||
      flow.updatedAt.toISOString() !== payload.flowRevision ||
      (flow.data as any)?.phoneNumberId !== payload.phoneNumberId ||
      business?.status !== 1 ||
      contact.status !== 1 ||
      handoff ||
      contact.waId !== payload.recipientWaId ||
      (contact.platform && contact.platform !== 'whatsapp') ||
      (contact.wabPhoneNumberId && contact.wabPhoneNumberId !== payload.phoneNumberId) ||
      due < at.getTime() - 24 * 3600000
    ) {
      await tx.userActiveFlows.delete({ where: { id: session.id } });
      return;
    }
    const graph = validateGraph((flow.data as any).graph, true);
    if (!(await graphTimingAllowed(tx, contact.vendorId, flow.triggerType, at)))
      throw new ApiError(409, 'GRAPH_TIMING_PAUSED', 'Bot timing currently prevents continuation');
    if (await graphAwayActive(tx, contact.vendorId, payload.phoneNumberId, at))
      throw new ApiError(
        409,
        'GRAPH_AWAY_PAUSED',
        'Out-of-office mode currently prevents continuation',
      );
    await graphQuestionFields(tx, contact.vendorId, graph);
    for (const node of graph.nodes.filter((n) => n.type === 'team_assignment'))
      await eligibleGraphAgent(tx, contact.vendorId, node.payload.assigned_team_member);
    const result = await prepareGraphMetaFlows(
      tx,
      contact,
      payload.phoneNumberId,
      await prepareGraphCatalogs(
        tx,
        contact,
        payload.phoneNumberId,
        await prepareGraphTemplates(
          tx,
          contact,
          payload.phoneNumberId,
          advanceGraph(
            graph,
            {
              nodeId: delay.nextNodeId,
              waiting: false,
              variables: data.state.variables,
              activeMenus: data.state.activeMenus,
            },
            {},
          ),
        ),
      ),
    );
    await commitGraphStep(
      tx,
      flow,
      contact,
      payload.phoneNumberId,
      receiptKey,
      result,
      session,
      at,
    );
    await tx.webhookReceipts.create({
      data: {
        provider: 'bot-flow-resume',
        eventKey: receiptKey,
        payload: { flowId: flow.id },
        processedAt: at,
      },
    });
  });
}
