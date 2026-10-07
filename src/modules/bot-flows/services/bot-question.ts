import { Prisma } from '@prisma/client';
import { ApiError } from '../../../shared/api-error.js';
import type { BotGraph, GraphNode } from './graph-types.types.js';
import {
  contactValueTypes,
  numericValue,
  validTypedValue,
  lockedContactFields,
} from '../../contacts/services/contact-values.js';

export const questionTypes = contactValueTypes;
const numeric = numericValue;
const bound = '(\\d+(?:\\.\\d+)?)';
const range = new RegExp(`^${bound}-${bound}$`),
  comparison = new RegExp(`^(>=|<=|>|<)${bound}$`);
export function validNumberRange(value: string) {
  const match = range.exec(value);
  return match
    ? new Prisma.Decimal(match[1]).lte(match[2])
    : comparison.test(value) || numeric.test(value);
}
export function questionMatches(input: string, condition: any): boolean {
  const value = condition.condition_value,
    normalized = input.trim().toLowerCase(),
    expected = value.trim().toLowerCase();
  switch (condition.condition_type) {
    case 'equals':
      return normalized === expected;
    case 'contains':
      return normalized.includes(expected);
    case 'starts_with':
      return normalized.startsWith(expected);
    case 'number_range': {
      if (!numeric.test(input.trim())) return false;
      const number = new Prisma.Decimal(input.trim()),
        limits = range.exec(value),
        operator = comparison.exec(value);
      if (limits) return number.gte(limits[1]) && number.lte(limits[2]);
      if (operator) {
        const other = new Prisma.Decimal(operator[2]);
        return operator[1] === '>='
          ? number.gte(other)
          : operator[1] === '<='
            ? number.lte(other)
            : operator[1] === '>'
              ? number.gt(other)
              : number.lt(other);
      }
      return number.eq(value);
    }
    default:
      return false;
  }
}
/** Input validation has no provider effects and is shared by previews and receipt execution. */
export function validQuestionAnswer(node: GraphNode, input: string, fieldType?: string): boolean {
  const value = input.trim(),
    rules = node.payload.validation_rules ?? {},
    type = fieldType ?? node.payload.input_type ?? 'text';
  if (!value) return node.payload.is_required === false;
  if (value.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return false;
  if (type === 'text') {
    const length = [...value].length;
    return (
      length >= (rules.min_length ?? 1) &&
      length <=
        (rules.max_length ?? (node.type === 'question' && node.payload.store_in_field ? 500 : 4096))
    );
  }
  if (!questionTypes.includes(type))
    throw new ApiError(
      409,
      'GRAPH_FIELD_TYPE_PENDING',
      'Custom field type is not supported by this question handler',
    );
  return validTypedValue(type, value);
}
/** Name references must resolve uniquely; legacy names are not unique in the database. */
export async function graphQuestionFields(
  tx: Prisma.TransactionClient,
  vendorId: number,
  graph: BotGraph,
  availabilityStatus = 409,
) {
  const result = new Map<
    string,
    {
      id: number;
      inputType: string;
    }
  >();
  for (const node of graph.nodes) {
    if (node.type !== 'custom_field' && !(node.type === 'question' && node.payload.store_in_field))
      continue;
    const fields = await tx.contactCustomFields.findMany({
      where: {
        vendorId,
        inputName:
          node.type === 'question' ? node.payload.store_in_field : node.payload.custom_field_name,
        ...(node.type === 'custom_field' ? { id: node.payload.custom_field_id } : {}),
      },
      take: 2,
    });
    if (fields.length !== 1)
      throw new ApiError(
        availabilityStatus,
        availabilityStatus === 400 ? 'INVALID_REFERENCE' : 'GRAPH_FIELD_UNAVAILABLE',
        'Custom field must resolve uniquely in this business',
      );
    const [current] = await lockedContactFields(tx, vendorId, [fields[0].id]);
    if (current.inputName !== fields[0].inputName)
      throw new ApiError(
        availabilityStatus,
        'GRAPH_FIELD_UNAVAILABLE',
        'Custom field changed while preparing the question',
      );
    if (!questionTypes.includes(current.inputType))
      throw new ApiError(
        409,
        'GRAPH_FIELD_TYPE_PENDING',
        'Custom field type is not supported by this question handler',
      );
    if (
      current.inputType === 'text' &&
      (node.payload.validation_rules?.min_length ?? 1) >
        (node.payload.validation_rules?.max_length ?? (node.type === 'question' ? 500 : 4096))
    )
      throw new ApiError(
        availabilityStatus,
        'INVALID_GRAPH',
        'Question length rules cannot accept an answer',
      );
    result.set(node.id, current);
  }
  return result;
}
