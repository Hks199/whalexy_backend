import { DateTime } from 'luxon';
import type { Prisma } from '@prisma/client';

export function withinBotTiming(at: Date, timezone: string, start: string, end: string) {
  const now = DateTime.fromJSDate(at, { zone: timezone });
  if (
    !now.isValid ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)
  )
    return false;
  const minute = now.hour * 60 + now.minute,
    from = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)),
    to = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  return (
    from === to || (from < to ? minute >= from && minute <= to : minute >= from || minute <= to)
  );
}
export async function graphTimingAllowed(
  tx: Prisma.TransactionClient,
  vendorId: number,
  triggerType: string,
  at: Date,
) {
  const rows = await tx.vendorSettings.findMany({
    where: {
      vendorId,
      name: {
        in: [
          'enable_bot_timing_restrictions',
          'bot_timing_timezone',
          'bot_start_timing',
          'bot_end_timing',
          'enable_selected_other_bot_timing_restrictions',
        ],
      },
    },
  });
  const values = Object.fromEntries(rows.map((r) => [r.name, r.value]));
  if (!['1', 'true', 'on'].includes(values.enable_bot_timing_restrictions ?? '')) return true;
  let restricted: any;
  try {
    restricted = JSON.parse(values.enable_selected_other_bot_timing_restrictions ?? '{}');
  } catch {
    return false;
  }
  if (!restricted || typeof restricted !== 'object' || Array.isArray(restricted)) return false;
  return (
    !Object.hasOwn(restricted, triggerType) ||
    withinBotTiming(
      at,
      values.bot_timing_timezone ?? 'UTC',
      values.bot_start_timing ?? '',
      values.bot_end_timing ?? '',
    )
  );
}
