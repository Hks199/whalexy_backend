import Joi from 'joi';
import { ApiError } from '../../../shared/api-error.js';
import { graphMediaSchema } from '../../messaging/services/media-message.js';
import { parameterSchema } from '../../../shared/templates/template-values.js';
import { richTemplateFields } from '../../../shared/templates/rich-template.js';
import { questionTypes, validNumberRange } from './bot-question.js';
import { ctaUrlSchema, ctaLabelSchema } from '../../messaging/services/interactive-message.js';
import { GraphNode, BotGraph } from './graph-types.types.js';

export const graphTypes = [
  'message',
  'question',
  'interactive',
  'goto',
  'wait',
  'team_assignment',
  'webhook',
  'custom_field',
  'media_message',
  'whatsapp_template',
  'whatsapp_flow',
  'stay_in_session',
  'catalog',
];

export const executableTypes = new Set([
  'message',
  'question',
  'interactive',
  'goto',
  'custom_field',
  'wait',
  'team_assignment',
  'media_message',
  'stay_in_session',
  'whatsapp_template',
  'catalog',
  'whatsapp_flow',
]);

export const identifier = Joi.string().pattern(/^[A-Za-z0-9_-]{1,100}$/),
  edge = identifier.allow(null),
  text = Joi.string()
    .min(1)
    .max(4096)
    .pattern(/^[^\x00-\x08\x0b\x0c\x0e-\x1f]*$/);

export const choice = Joi.object({
  id: identifier.required(),
  title: Joi.string().min(1).max(24).required(),
  description: Joi.string().max(72),
  next_node: edge.required(),
});

export const fieldName = Joi.string()
  .pattern(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
  .invalid('__proto__', 'constructor', 'prototype');

export const questionRules = Joi.object({
  min_length: Joi.number().integer().min(0).max(4096),
  max_length: Joi.number().integer().min(1).max(4096),
}).custom((v, h) => ((v.min_length ?? 1) > (v.max_length ?? 4096) ? h.error('any.invalid') : v));

export const condition = Joi.object({
  condition_type: Joi.string()
    .valid('equals', 'contains', 'starts_with', 'number_range')
    .required(),
  condition_value: Joi.string().max(200).allow('').required(),
  target_node: edge.required(),
}).custom((v, h) =>
  v.condition_type === 'number_range' && !validNumberRange(v.condition_value)
    ? h.error('any.invalid')
    : v,
);

export const payloads: Record<string, Joi.Schema> = {
  whatsapp_flow: Joi.object({
    flow_id: Joi.string()
      .pattern(/^\d{5,100}$/)
      .required(),
    cta_text: text.max(20).allow(''),
    header_text: text.max(60).allow(''),
    body_text: text.max(1024).allow(''),
    footer_text: text.max(60).allow(''),
  }),
  catalog: Joi.object({
    catalog_id: Joi.number().integer().positive().max(2147483647).required(),
    mode: Joi.string().valid('single', 'multiple', 'catalog').required(),
    product_ids: Joi.array()
      .items(Joi.number().integer().positive().max(2147483647))
      .unique()
      .max(30)
      .required(),
    body: text.max(1024).allow(''),
  }).custom((value, helpers) =>
    (value.mode === 'single' && value.product_ids.length !== 1) ||
    (value.mode === 'multiple' && !value.product_ids.length) ||
    (value.mode === 'catalog' && value.product_ids.length)
      ? helpers.error('any.invalid')
      : value,
  ),
  whatsapp_template: Joi.object({
    whatsapp_template_id: Joi.number().integer().positive().max(2147483647).required(),
    bodyParameters: Joi.array().items(parameterSchema).max(20),
    headerParameters: Joi.array().items(parameterSchema).max(1),
    ...richTemplateFields(parameterSchema),
  }),
  stay_in_session: Joi.object({ text: text.allow('') }),
  media_message: graphMediaSchema,
  message: Joi.object({ text: text.required() }),
  question: Joi.object({
    text: text.required(),
    variable_name: fieldName.required(),
    store_in_field: fieldName,
    input_type: Joi.string().valid(...questionTypes),
    is_required: Joi.boolean(),
    validation_rules: questionRules,
    error_message: text.max(1024),
    conditional_flows: Joi.array().items(condition).max(20),
    default_next_node: edge,
  }),
  custom_field: Joi.object({
    question_text: text.required(),
    custom_field_id: Joi.number().integer().positive().max(2147483647).required(),
    custom_field_name: Joi.string()
      .pattern(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
      .invalid('__proto__', 'constructor', 'prototype')
      .required(),
  }),
  goto: Joi.object({ redirect_to_node: identifier.required() }),
  wait: Joi.object({
    wait_time: Joi.number().integer().min(1).max(604800).required(),
    wait_message: text,
    text,
  }),
  team_assignment: Joi.object({
    assigned_team_member: identifier.min(10).required(),
    assigned_team_member_name: Joi.string().max(200),
    assignment_message: text.required(),
  }),
  interactive: Joi.object({
    text: Joi.string().min(1).max(1024).required(),
    interactive_type: Joi.string().valid('button', 'list', 'cta_url').required(),
    button_display_text: Joi.when('interactive_type', {
      is: 'cta_url',
      then: ctaLabelSchema.required(),
      otherwise: Joi.forbidden(),
    }),
    button_url: Joi.when('interactive_type', {
      is: 'cta_url',
      then: ctaUrlSchema.required(),
      otherwise: Joi.forbidden(),
    }),
    buttons: Joi.when('interactive_type', {
      is: 'button',
      then: Joi.array().items(choice).min(1).max(3).required(),
      otherwise: Joi.forbidden(),
    }),
    sections: Joi.when('interactive_type', {
      is: 'list',
      then: Joi.array()
        .items(
          Joi.object({
            title: Joi.string().min(1).max(24).required(),
            rows: Joi.array().items(choice).min(1).max(10).required(),
          }),
        )
        .min(1)
        .max(10)
        .required(),
      otherwise: Joi.forbidden(),
    }),
    button_text: Joi.when('interactive_type', {
      is: 'list',
      then: Joi.string().min(1).max(20).required(),
      otherwise: Joi.forbidden(),
    }),
  }),
};

export const graphSchema = Joi.object({
  flow_id: identifier,
  start_node: identifier.required(),
  nodes: Joi.array()
    .items(
      Joi.object({
        id: identifier.required(),
        type: Joi.string()
          .valid(...graphTypes)
          .required(),
        payload: Joi.object().required(),
        next_node: edge.default(null),
        position: Joi.object({
          x: Joi.number().min(-100000).max(100000).required(),
          y: Joi.number().min(-100000).max(100000).required(),
        }),
      }),
    )
    .min(1)
    .max(200)
    .required(),
});

export function graphChoices(node: GraphNode): any[] {
  return node.payload.buttons ?? node.payload.sections?.flatMap((s: any) => s.rows) ?? [];
}

export function validateGraph(input: unknown, enabled = false): BotGraph {
  // The source exporter uses start_node_id and stores some edges inside payload.
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    input = structuredClone(input);
    const source = input as any;
    if (source.start_node_id !== undefined && source.start_node === undefined) {
      source.start_node = source.start_node_id;
      delete source.start_node_id;
    }
    if (Array.isArray(source.nodes))
      for (const node of source.nodes)
        if (
          node?.payload &&
          typeof node.payload === 'object' &&
          !Array.isArray(node.payload) &&
          node.payload.next_node !== undefined
        ) {
          if (node.next_node !== undefined && node.next_node !== node.payload.next_node)
            throw new ApiError(400, 'INVALID_GRAPH', 'Conflicting node connections');
          node.next_node = node.payload.next_node;
          delete node.payload.next_node;
        }
  }
  const { value, error } = graphSchema.validate(input, { allowUnknown: false, convert: false });
  if (error) throw new ApiError(400, 'INVALID_GRAPH', 'Invalid graph structure');
  const graph = value as BotGraph,
    ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length || !ids.has(graph.start_node))
    throw new ApiError(
      400,
      'INVALID_GRAPH',
      'Node identifiers must be unique and the start node must exist',
    );
  for (const node of graph.nodes) {
    const schema = payloads[node.type];
    if (schema && schema.validate(node.payload, { allowUnknown: false, convert: false }).error)
      throw new ApiError(400, 'INVALID_GRAPH', 'Invalid node payload');
    if (!schema && JSON.stringify(node.payload).length > 20000)
      throw new ApiError(400, 'INVALID_GRAPH', 'Draft payload is too large');
    if (enabled && !executableTypes.has(node.type))
      throw new ApiError(
        409,
        'GRAPH_HANDLER_PENDING',
        'This flow includes a node whose runtime is not converted',
      );
    if (enabled && node.type === 'team_assignment' && node.next_node)
      throw new ApiError(
        409,
        'GRAPH_HANDLER_PENDING',
        'Continuing automation after a team handoff requires a reviewed handler',
      );
    if (node.type === 'stay_in_session' && node.next_node)
      throw new ApiError(400, 'INVALID_GRAPH', 'Session nodes have no outgoing connection');
    const choices = graphChoices(node);
    if (
      node.type === 'interactive' &&
      node.payload.interactive_type === 'button' &&
      choices.some((c) => c.title.length > 20)
    )
      throw new ApiError(400, 'INVALID_GRAPH', 'Button titles support at most twenty characters');
    if (
      node.type === 'interactive' &&
      (choices.length > 10 || new Set(choices.map((c) => c.id)).size !== choices.length)
    )
      throw new ApiError(
        400,
        'INVALID_GRAPH',
        'Choice identifiers must be unique and lists support at most ten rows',
      );
    const edges = [
      node.next_node,
      ...(node.type === 'goto' ? [node.payload.redirect_to_node] : []),
      ...(node.type === 'interactive' ? choices.map((c) => c.next_node) : []),
      ...(node.type === 'question'
        ? [
            ...(node.payload.conditional_flows ?? []).map((c: any) => c.target_node),
            ...(Object.hasOwn(node.payload, 'default_next_node')
              ? [node.payload.default_next_node]
              : []),
          ]
        : []),
    ];
    if (edges.some((e) => e !== null && !ids.has(e)))
      throw new ApiError(400, 'INVALID_GRAPH', 'A connection references a missing node');
  }
  // Cycles through an input node are legitimate; automatic cycles can exhaust the worker.
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const walk = (id: string) => {
    if (visiting.has(id))
      throw new ApiError(400, 'INVALID_GRAPH', 'Automatic connections contain a cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodes.get(id)!;
    if (
      [
        'message',
        'goto',
        'wait',
        'team_assignment',
        'media_message',
        'whatsapp_template',
        'catalog',
        'whatsapp_flow',
      ].includes(node.type) ||
      (node.type === 'interactive' && node.payload.interactive_type === 'cta_url')
    ) {
      const next = node.type === 'goto' ? node.payload.redirect_to_node : node.next_node;
      if (next) walk(next);
    }
    visiting.delete(id);
    visited.add(id);
  };
  graph.nodes.forEach((n) => walk(n.id));
  return graph;
}
