import { DateTime, IANAZone } from 'luxon';
import {
  Prisma,
  type OutOfOfficeSettings,
  type OutOfOfficeSchedules,
  type Contacts,
} from '@prisma/client';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { currentContactPermissions } from '../contact-workflows/services/contact-administration.service.js';
import { digest } from '../../utils/crypto.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export const DEFAULT_AWAY_MESSAGE =
  "Hi! 👋 Thanks for reaching out. We're currently outside our business hours. We'll get back to you as soon as we're available.";
export type Schedule = Pick<
  OutOfOfficeSchedules,
  'dayOfWeek' | 'enabled' | 'startTime' | 'endTime'
>;
export type Setting = Pick<
  OutOfOfficeSettings,
  'enabled' | 'timezone' | 'mode' | 'manualUntil' | 'manualStartedAt' | 'updatedAt'
>;
export const stamp = (date: DateTime) => date.toUTC().toFormat('yyyyMMddHHmmss');
/** Port of OutOfOfficeScheduleEvaluator; calendar days are evaluated in the business timezone. */
export function awayState(settings: Setting, schedules: Schedule[], at: Date = new Date()) {
  const now = DateTime.fromJSDate(at, { zone: settings.timezone || 'UTC' });
  if (!now.isValid)
    throw new ApiError(400, 'INVALID_TIMEZONE', 'Out of office timezone is invalid');
  const result = (
    businessOpen: boolean,
    oooActive: boolean,
    reason: string,
    nextOpening: DateTime | null = null,
    currentClosing: DateTime | null = null,
    periodKey: string | null = null,
  ) => ({
    business_open: businessOpen,
    ooo_active: oooActive,
    reason,
    now: now.toISO(),
    next_opening: nextOpening?.toISO() ?? null,
    current_closing: currentClosing?.toISO() ?? null,
    period_key: periodKey,
  });
  if (!settings.enabled) return result(false, false, 'disabled');
  if (settings.mode === 'always_available') return result(true, false, 'always_available');
  if (
    settings.mode === 'out_of_office_now' &&
    (!settings.manualUntil || at < settings.manualUntil)
  ) {
    const started = DateTime.fromJSDate(settings.manualStartedAt ?? settings.updatedAt ?? at);
    return result(
      false,
      true,
      'manual',
      settings.manualUntil
        ? DateTime.fromJSDate(settings.manualUntil, { zone: settings.timezone })
        : null,
      null,
      `manual:${stamp(started)}`,
    );
  }
  const intervals: [DateTime, DateTime][] = [];
  for (let offset = -8; offset <= 14; offset++) {
    const date = now.startOf('day').plus({ days: offset });
    for (const row of schedules) {
      if (!row.enabled || row.dayOfWeek !== date.weekday || !row.startTime || !row.endTime)
        continue;
      const start = DateTime.fromISO(`${date.toISODate()}T${row.startTime}`, {
        zone: settings.timezone,
      });
      const end = DateTime.fromISO(`${date.toISODate()}T${row.endTime}`, {
        zone: settings.timezone,
      });
      if (start.isValid && end.isValid && start < end) intervals.push([start, end]);
    }
  }
  intervals.sort((a, b) => a[0].toMillis() - b[0].toMillis());
  for (const [start, end] of intervals)
    if (now >= start && now < end) return result(true, false, 'open', null, end);
  let previous: DateTime | null = null,
    next: DateTime | null = null;
  for (const [start, end] of intervals) {
    if (end <= now && (!previous || end > previous)) previous = end;
    if (start > now && (!next || start < next)) next = start;
  }
  return result(
    false,
    true,
    'closed',
    next,
    null,
    `schedule:${previous ? stamp(previous) : 'origin'}:${next ? stamp(next) : 'open-ended'}`,
  );
}
export const defaultSchedule = (): Schedule[] =>
  Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i + 1,
    enabled: i < 5,
    startTime: i < 5 ? '09:00:00' : null,
    endTime: i < 5 ? '18:00:00' : null,
  }));
export function scheduleForm(rows: Schedule[]) {
  return Array.from({ length: 7 }, (_, i) => {
    const selected = rows
      .filter((r) => r.dayOfWeek === i + 1 && r.enabled && r.startTime && r.endTime)
      .sort((a, b) => a.startTime!.localeCompare(b.startTime!));
    return {
      day_of_week: i + 1,
      enabled: !!selected.length,
      intervals: selected.map((r) => ({
        start: r.startTime!.slice(0, 5),
        end: r.endTime!.slice(0, 5),
      })),
    };
  });
}
export async function connected(vendorId: number, externalId: string) {
  if (
    !(await db.integrationCredentials.findUnique({
      where: { vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId } },
    }))
  )
    throw new ApiError(404, 'NOT_FOUND', 'Connected WhatsApp number not found');
}
/** Called inside the inbound-message transaction, after its duplicate guard. */
export async function graphAwayActive(
  tx: Prisma.TransactionClient,
  vendorId: number,
  phoneId: string,
  at = new Date(),
) {
  const setting = await tx.outOfOfficeSettings.findUnique({
    where: { vendorId_whatsappPhoneNumberId: { vendorId, whatsappPhoneNumberId: phoneId } },
  });
  if (!setting?.enabled || !setting.message.trim()) return false;
  const schedules = await tx.outOfOfficeSchedules.findMany({
    where: { outOfOfficeSettingsId: setting.id },
  });
  return awayState(setting, schedules, at).ooo_active;
}
export async function queueAwayReply(
  tx: Prisma.TransactionClient,
  vendorId: number,
  phoneId: string,
  contact: Contacts,
  inboundId: string,
  receivedAt: Date,
  at = new Date(),
) {
  if (
    !contact.waId ||
    !Number.isFinite(receivedAt.getTime()) ||
    receivedAt.getTime() < at.getTime() - 24 * 3600000 ||
    receivedAt.getTime() > at.getTime() + 5 * 60000
  )
    return false;
  if (
    await tx.aiConversationHandoffs.findFirst({
      where: { vendorId, contactId: contact.id, status: { in: ['waiting', 'accepted'] } },
      select: { id: true },
    })
  )
    return false;
  const setting = await tx.outOfOfficeSettings.findUnique({
    where: { vendorId_whatsappPhoneNumberId: { vendorId, whatsappPhoneNumberId: phoneId } },
  });
  if (!setting?.enabled || !setting.message.trim()) return false;
  const schedules = await tx.outOfOfficeSchedules.findMany({
    where: { outOfOfficeSettingsId: setting.id },
  });
  const state = awayState(setting, schedules, at);
  if (!state.ooo_active || !state.period_key) return false;
  const key = {
    outOfOfficeSettingsId: setting.id,
    customerIdentifier: contact.waId,
    oooPeriodKey: state.period_key,
  };
  const created = await tx.outOfOfficeDeliveries.createMany({
    data: [{ ...key, contactId: contact.id, inboundMessageId: inboundId, status: 'processing' }],
    skipDuplicates: true,
  });
  const delivery = await tx.outOfOfficeDeliveries.findUniqueOrThrow({
    where: { outOfOfficeSettingsId_customerIdentifier_oooPeriodKey: key },
  });
  if (!created.count) {
    if (delivery.status === 'failed') {
      const retry = await tx.outboxJobs.updateMany({
        where: { dedupeKey: `ooo:${delivery.id}`, status: 'failed' },
        data: { status: 'pending', attempts: 0, availableAt: at, lastError: null },
      });
      if (retry.count)
        await tx.outOfOfficeDeliveries.update({
          where: { id: delivery.id },
          data: {
            status: 'processing',
            inboundMessageId: inboundId,
            failureReason: null,
            updatedAt: at,
          },
        });
    }
    return true;
  }
  const log = await tx.whatsappMessageLogs.create({
    data: {
      vendorId,
      contactId: contact.id,
      contactWaId: contact.waId,
      wabPhoneNumberId: phoneId,
      message: setting.message,
      type: 'text',
      isIncomingMessage: false,
      status: 'queued',
      messagedAt: at,
    },
  });
  await tx.outboxJobs.create({
    data: {
      vendorId,
      kind: 'whatsapp-send',
      dedupeKey: `ooo:${delivery.id}`,
      payload: {
        awayDeliveryId: delivery.id,
        messageId: log.id,
        phoneNumberId: phoneId,
        payload: {
          messaging_product: 'whatsapp',
          to: contact.waId,
          type: 'text',
          text: { body: setting.message, preview_url: false },
        },
      },
    },
  });
  return true;
}
async function authorizeAway(
  tx: Prisma.TransactionClient,
  input: ServiceContext,
  permission: string,
) {
  const permissions = await currentContactPermissions(tx, input);
  if (!permissions.includes('*') && !permissions.includes(permission))
    throw new ApiError(403, 'FORBIDDEN', 'Current out of office permission required');
}
export async function getAwaySettings(requestInput: ServiceContext) {
  const vendorId = requestInput.identity!.vendorId!;
  const configuration = await db.$transaction(async (tx) => {
    await authorizeAway(tx, requestInput, 'vendor.out_of_office.view');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(604, ${vendorId}::integer)`;
    const preferences = await tx.vendorSettings.findMany({
      where: { vendorId, name: { in: ['current_phone_number_id', 'timezone'] } },
    });
    const phoneId =
      requestInput.validatedQuery.phone_number_id ??
      preferences.find((p) => p.name === 'current_phone_number_id')?.value;
    if (!phoneId || !/^\d{5,100}$/.test(phoneId))
      throw new ApiError(400, 'PHONE_NUMBER_REQUIRED', 'Select a connected business number');
    const where = { vendorId_whatsappPhoneNumberId: { vendorId, whatsappPhoneNumberId: phoneId } };
    let settings = await tx.outOfOfficeSettings.findUnique({ where });
    const credential = await tx.integrationCredentials.findUnique({
      where: {
        vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneId },
      },
      select: { id: true },
    });
    if (!settings && !credential)
      throw new ApiError(404, 'NOT_FOUND', 'Owned business number not found');
    if (
      settings?.mode === 'out_of_office_now' &&
      settings.manualUntil &&
      settings.manualUntil <= new Date()
    ) {
      settings = await tx.outOfOfficeSettings.update({
        where,
        data: {
          mode: 'business_hours',
          manualUntil: null,
          manualStartedAt: null,
          updatedAt: new Date(),
        },
      });
      await tx.auditEvents.create({
        data: {
          vendorId,
          actorId: requestInput.identity!.userId,
          action: 'expire-manual',
          resource: 'out-of-office',
          resourceId: String(settings.id),
        },
      });
    }
    const rows = settings
      ? await tx.outOfOfficeSchedules.findMany({ where: { outOfOfficeSettingsId: settings.id } })
      : defaultSchedule();
    const preferredZone = preferences.find((p) => p.name === 'timezone')?.value;
    const defaults = {
      enabled: false,
      message: DEFAULT_AWAY_MESSAGE,
      timezone: preferredZone && IANAZone.isValidZone(preferredZone) ? preferredZone : 'UTC',
      mode: 'business_hours',
      manualUntil: null,
      manualStartedAt: null,
      updatedAt: new Date(),
    };
    return {
      settings: settings ?? defaults,
      schedule: scheduleForm(rows),
      status: awayState(settings ?? defaults, rows),
      phone_number_id: phoneId,
    };
  });
  return serviceResult(configuration, { status: 200, format: 'json' });
}
function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
export async function updateAwaySettings(requestInput: ServiceContext, legacy = false) {
  const vendorId = requestInput.identity!.vendorId!,
    input = requestInput.body,
    phoneId = input.whatsapp_phone_number_id;
  const key = requestInput.headers['idempotency-key'];
  if (legacy && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)))
    throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  const hash = digest(JSON.stringify(canonical(input)));
  const result = await db
    .$transaction(
      async (tx) => {
        await authorizeAway(tx, requestInput, 'vendor.out_of_office.manage');
        // Serializes creation too, where a settings row does not yet exist.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(604, ${vendorId}::integer)`;
        if (legacy) {
          const replay = await tx.nativeIdempotency.findUnique({
            where: { vendorId_key: { vendorId, key: `legacy-away:${key}` } },
          });
          if (replay) {
            if (replay.requestHash !== hash)
              throw new ApiError(
                409,
                'IDEMPOTENCY_CONFLICT',
                'Key was used for other away settings',
              );
            return replay.response;
          }
        }
        const old = await tx.outOfOfficeSettings.findUnique({
          where: { vendorId_whatsappPhoneNumberId: { vendorId, whatsappPhoneNumberId: phoneId } },
        });
        const credential = await tx.integrationCredentials.findUnique({
          where: {
            vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phoneId },
          },
          select: { id: true },
        });
        if (!credential && (input.enabled || !old))
          throw new ApiError(404, 'NOT_FOUND', 'Connected WhatsApp number not found');
        const values = {
          enabled: input.enabled,
          message: input.message ?? '',
          timezone: input.timezone,
          mode: input.mode,
          manualUntil:
            input.mode === 'out_of_office_now' && input.manual_until
              ? DateTime.fromISO(input.manual_until, { zone: input.timezone }).toUTC().toJSDate()
              : null,
          manualStartedAt:
            input.mode === 'out_of_office_now'
              ? old?.mode === 'out_of_office_now'
                ? old.manualStartedAt
                : new Date()
              : null,
          updatedAt: new Date(),
        };
        const setting = await tx.outOfOfficeSettings.upsert({
          where: { vendorId_whatsappPhoneNumberId: { vendorId, whatsappPhoneNumberId: phoneId } },
          create: { vendorId, whatsappPhoneNumberId: phoneId, ...values },
          update: values,
        });
        await tx.outOfOfficeSchedules.deleteMany({ where: { outOfOfficeSettingsId: setting.id } });
        const rows: Schedule[] = input.schedule.flatMap((day: any) =>
          day.enabled
            ? day.intervals.map((interval: any) => ({
                dayOfWeek: day.day_of_week,
                enabled: true,
                startTime: `${interval.start}:00`,
                endTime: `${interval.end}:00`,
              }))
            : [{ dayOfWeek: day.day_of_week, enabled: false, startTime: null, endTime: null }],
        );
        await tx.outOfOfficeSchedules.createMany({
          data: rows.map((row) => ({ outOfOfficeSettingsId: setting.id, ...row })),
        });
        await tx.auditEvents.create({
          data: {
            vendorId,
            actorId: requestInput.identity!.userId,
            action: 'configure',
            resource: 'out-of-office',
            resourceId: String(setting.id),
          },
        });
        const response = {
          reaction_code: 1,
          message: 'Changes saved successfully.',
          data: { status: awayState(setting, rows) },
          show_message: true,
        };
        if (legacy)
          await tx.nativeIdempotency.create({
            data: {
              vendorId,
              key: `legacy-away:${key}`,
              requestHash: hash,
              response: response as unknown as Prisma.InputJsonObject,
            },
          });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(409, 'AWAY_CONFLICT', 'Away settings changed; retry the request');
      throw error;
    });
  return serviceResult(result, { status: 200, format: 'json' });
}
