import { Prisma } from '@prisma/client';
import Joi from 'joi';
import { ApiError } from '../../../shared/api-error.js';

// Summing up to 10,000 Decimal(18,4) rows needs more than the default 20 digits.
const ReportDecimal = Prisma.Decimal.clone({ precision: 40 });
export const adDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((v, h) => {
    const date = new Date(v + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
      ? v
      : h.error('any.invalid');
  });
export function adRange(from: string, to: string) {
  if (
    adDate.validate(from).error ||
    adDate.validate(to).error ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 92 ||
    to > new Date().toISOString().slice(0, 10)
  )
    throw new ApiError(400, 'INVALID_AD_RANGE', 'Use a valid past date range of at most 93 days');
  return { from: new Date(from + 'T00:00:00Z'), to: new Date(to + 'T00:00:00Z') };
}
export function badInsight(): never {
  throw new ApiError(502, 'AD_RESPONSE_INVALID', 'Meta ad data requires reconciliation');
}
export function adAmount(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,14}(?:\.\d{1,4})?$/.test(value)) badInsight();
  return new Prisma.Decimal(value);
}
function count(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value) || Number(value) > 2147483647)
    badInsight();
  return Number(value);
}
function actions(value: unknown, money = false) {
  if (value === undefined) return new Map<string, string>();
  if (!Array.isArray(value) || value.length > 500) badInsight();
  const result = new Map<string, string>();
  for (const row of value) {
    if (
      !row ||
      typeof row.action_type !== 'string' ||
      !row.action_type ||
      row.action_type.length > 200 ||
      result.has(row.action_type)
    )
      badInsight();
    if (money) adAmount(row.value);
    else count(row.value);
    result.set(row.action_type, row.value);
  }
  return result;
}
export function insightRow(row: any, currency: string, from: string, to: string) {
  if (
    !row ||
    typeof row.campaign_id !== 'string' ||
    !/^\d{5,100}$/.test(row.campaign_id) ||
    row.account_currency !== currency ||
    typeof row.date_start !== 'string' ||
    row.date_start !== row.date_stop ||
    adDate.validate(row.date_start).error ||
    row.date_start < from ||
    row.date_start > to
  )
    badInsight();
  const action = actions(row.actions),
    values = actions(row.action_values, true);
  return {
    campaignId: row.campaign_id as string,
    metricDate: new Date(row.date_start + 'T00:00:00Z'),
    spend: adAmount(row.spend),
    reach: count(row.reach),
    impressions: count(row.impressions),
    clicks: count(row.clicks),
    conversations: count(action.get('onsite_conversion.messaging_conversation_started_7d') ?? '0'),
    leads: count(action.get('lead') ?? '0'),
    purchases: count(action.get('purchase') ?? '0'),
    revenue: adAmount(values.get('purchase') ?? '0'),
  };
}
export function summarizeAds(
  rows: {
    spend: Prisma.Decimal;
    revenue: Prisma.Decimal;
    reach: number;
    impressions: number;
    clicks: number;
    conversations: number;
    leads: number;
    purchases: number;
  }[],
) {
  let spend = new ReportDecimal(0),
    revenue = new ReportDecimal(0),
    reach = 0,
    impressions = 0,
    clicks = 0,
    conversations = 0,
    leads = 0,
    purchases = 0;
  for (const row of rows) {
    spend = spend.plus(row.spend);
    revenue = revenue.plus(row.revenue);
    reach += row.reach;
    impressions += row.impressions;
    clicks += row.clicks;
    conversations += row.conversations;
    leads += row.leads;
    purchases += row.purchases;
  }
  const ratio = (a: Prisma.Decimal | number, b: Prisma.Decimal | number, multiplier = 1) =>
    new ReportDecimal(b).isZero()
      ? '0'
      : new ReportDecimal(a).div(b).mul(multiplier).toDecimalPlaces(4).toString();
  return {
    spend: spend.toFixed(4),
    revenue: revenue.toFixed(4),
    summedReach: reach,
    impressions,
    clicks,
    conversations,
    leads,
    purchases,
    ctr: ratio(clicks, impressions, 100),
    cpc: ratio(spend, clicks),
    cpm: ratio(spend, impressions, 1000),
    costPerConversation: ratio(spend, conversations),
    roas: ratio(revenue, spend),
  };
}
export function adCsvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
