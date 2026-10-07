import { ApiError } from '../../../shared/api-error.js';
import { mediaContent } from '../../messaging/services/media-message.js';
import { questionMatches, validQuestionAnswer } from './bot-question.js';
import { interactiveMessageSchema } from '../../messaging/services/interactive-message.js';
import { BotGraph, GraphState, GraphInput, GraphResult } from './graph-types.types.js';
import { graphChoices, executableTypes } from './graph-schema.validation.js';

export function advanceGraph(
  graph: BotGraph,
  state: GraphState | null,
  input: GraphInput,
  initialVariables: Record<string, string> = {},
): GraphResult {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n])),
    variables = Object.assign(
      Object.create(null),
      initialVariables,
      state?.variables ?? {},
    ) as Record<string, string>;
  let id: string | null = state?.nodeId ?? graph.start_node;
  const activeMenus = [...(state?.activeMenus ?? [])];
  if (state?.waiting && id) {
    const waiting = nodes.get(id);
    if (!waiting) throw new ApiError(409, 'GRAPH_STATE_INVALID', 'Waiting node no longer exists');
    if (waiting.type === 'stay_in_session') {
      const command = input.text?.trim().toLowerCase();
      if (command && ['exit', 'quit', 'end', 'stop', 'bye', 'goodbye'].includes(command))
        return {
          state: { nodeId: null, waiting: false, variables },
          messages: [],
          resetSelections: true,
        };
      if (command && ['restart', 'reset', 'start over', 'begin'].includes(command))
        return {
          state: { nodeId: id, waiting: true, variables: { ...initialVariables }, activeMenus: [] },
          messages: [],
          resetSelections: true,
        };
      const menu =
        input.selectionNodeId && activeMenus.includes(input.selectionNodeId)
          ? nodes.get(input.selectionNodeId)
          : undefined;
      const choice =
        menu?.type === 'interactive'
          ? graphChoices(menu).find((c) => c.id === input.selection)
          : undefined;
      if (!choice) return { state, messages: [] };
      id = choice.next_node;
      if (id && nodes.get(id)?.type === 'stay_in_session') return { state, messages: [] };
    } else if (['question', 'custom_field'].includes(waiting.type)) {
      if (
        input.text === undefined ||
        input.text.length > 4096 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.text)
      )
        return { state, messages: [] };
      if (!validQuestionAnswer(waiting, input.text, input.fieldType))
        return {
          state,
          messages: [
            {
              nodeId: id,
              type: 'text',
              text: {
                body: waiting.payload.error_message ?? 'Please enter a valid answer.',
                preview_url: false,
              },
            },
          ],
        };
      const answer = input.text.trim();
      variables[
        waiting.type === 'question'
          ? waiting.payload.variable_name
          : waiting.payload.custom_field_name
      ] = answer;
      const branch =
        waiting.type === 'question'
          ? waiting.payload.conditional_flows?.find((c: any) => questionMatches(answer, c))
          : undefined;
      id = branch
        ? branch.target_node
        : Object.hasOwn(waiting.payload, 'default_next_node')
          ? waiting.payload.default_next_node
          : waiting.next_node;
    } else if (waiting.type === 'interactive') {
      const selected = graphChoices(waiting).find((c) => c.id === input.selection);
      if (!selected || (input.selectionNodeId && input.selectionNodeId !== waiting.id))
        return { state, messages: [] };
      id = selected.next_node;
    }
  }
  const messages: any[] = [];
  const render = (value: string, limit = 4096) => {
    const rendered = value.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key: string) =>
      Object.hasOwn(variables, key) ? variables[key] : match,
    );
    if (rendered.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(rendered))
      throw new ApiError(409, 'GRAPH_RENDER_INVALID', 'Rendered node exceeds provider limits');
    return rendered;
  };
  for (let step = 0; id; step++) {
    if (step >= 50 || messages.length >= 20)
      throw new ApiError(409, 'GRAPH_EXECUTION_LIMIT', 'Graph exceeded its execution limit');
    const node = nodes.get(id)!;
    if (!node || !executableTypes.has(node.type))
      throw new ApiError(409, 'GRAPH_HANDLER_PENDING', 'Node runtime is not available');
    if (node.type === 'goto') {
      id = node.payload.redirect_to_node;
      continue;
    }
    if (node.type === 'whatsapp_flow') {
      const presentation = Object.fromEntries(
        [
          ['cta_text', 20],
          ['header_text', 60],
          ['body_text', 1024],
          ['footer_text', 60],
        ]
          .filter(([key]) => node.payload[key] !== undefined)
          .map(([key, limit]) => [key, render(node.payload[key], Number(limit))]),
      );
      messages.push({
        nodeId: id,
        graphMetaFlow: { flow_id: node.payload.flow_id, ...presentation },
      });
      id = node.next_node;
      continue;
    }
    if (node.type === 'catalog') {
      messages.push({
        nodeId: id,
        graphCatalog: {
          ...node.payload,
          ...(node.payload.body !== undefined ? { body: render(node.payload.body, 1024) } : {}),
        },
      });
      id = node.next_node;
      continue;
    }
    if (node.type === 'whatsapp_template') {
      const parameter = (p: any) => ({
        ...p,
        ...(p.literal !== undefined ? { literal: render(p.literal, 1024) } : {}),
        ...(p.fallback !== undefined ? { fallback: render(p.fallback, 1024) } : {}),
      });
      const values = Object.fromEntries(
        ['bodyParameters', 'headerParameters']
          .filter((key) => node.payload[key])
          .map((key) => [key, node.payload[key].map(parameter)]),
      );
      if (node.payload.buttonParameters !== undefined)
        values.buttonParameters = node.payload.buttonParameters.map((button: any) => ({
          ...button,
          value: parameter(button.value),
        }));
      if (node.payload.mediaHeader)
        values.mediaHeader = {
          ...node.payload.mediaHeader,
          ...(node.payload.mediaHeader.filename !== undefined
            ? { filename: render(node.payload.mediaHeader.filename, 240) }
            : {}),
        };
      if (node.payload.copyCode !== undefined) values.copyCode = render(node.payload.copyCode, 15);
      messages.push({
        nodeId: id,
        graphTemplate: { whatsapp_template_id: node.payload.whatsapp_template_id, ...values },
      });
      id = node.next_node;
      continue;
    }
    if (node.type === 'stay_in_session') {
      messages.push({
        nodeId: id,
        type: 'text',
        text: {
          body: render(node.payload.text || 'Session will remain active...'),
          preview_url: false,
        },
      });
      return { state: { nodeId: id, waiting: true, variables, activeMenus }, messages };
    }
    if (node.type === 'media_message') {
      messages.push({
        nodeId: id,
        ...mediaContent({
          type: node.payload.media_type,
          url: node.payload.media_url,
          ...(node.payload.caption !== undefined
            ? { caption: render(node.payload.caption, 1024) }
            : {}),
          ...(node.payload.filename ? { filename: node.payload.filename } : {}),
        }),
      });
      id = node.next_node;
      continue;
    }
    if (node.type === 'wait') {
      messages.push({
        nodeId: id,
        type: 'text',
        text: {
          body: render(node.payload.wait_message ?? node.payload.text ?? 'Please wait...'),
          preview_url: false,
        },
      });
      return {
        state: { nodeId: node.next_node ? id : null, waiting: false, variables, activeMenus },
        messages,
        ...(node.next_node
          ? { delay: { seconds: node.payload.wait_time, nextNodeId: node.next_node } }
          : {}),
      };
    }
    if (node.type === 'team_assignment') {
      messages.push({
        nodeId: id,
        type: 'text',
        text: { body: render(node.payload.assignment_message), preview_url: false },
      });
      return {
        state: { nodeId: null, waiting: false, variables },
        messages,
        assignment: { nodeId: id, userUid: node.payload.assigned_team_member },
      };
    }
    if (node.type === 'interactive') {
      if (node.payload.interactive_type === 'cta_url') {
        const title = render(node.payload.button_display_text, 20);
        const body = render(node.payload.text, 1024);
        if (
          interactiveMessageSchema.validate(
            { type: 'cta_url', body, cta: { title, url: node.payload.button_url } },
            { convert: false },
          ).error
        )
          throw new ApiError(409, 'GRAPH_RENDER_INVALID', 'Rendered CTA message is invalid');
        messages.push({
          nodeId: id,
          type: 'interactive',
          interactive: {
            type: 'cta_url',
            body: { text: body },
            action: {
              name: 'cta_url',
              parameters: { display_text: title, url: node.payload.button_url },
            },
          },
        });
        id = node.next_node;
        continue;
      }
      if (!activeMenus.includes(id)) activeMenus.push(id);
      const p = node.payload;
      const interactive: any = {
        type: p.interactive_type,
        body: { text: render(p.text, 1024) },
        action:
          p.interactive_type === 'button'
            ? {
                buttons: p.buttons.map((c: any) => ({
                  type: 'reply',
                  reply: { id: c.id, title: render(c.title, 20) },
                })),
              }
            : {
                button: render(p.button_text, 20),
                sections: p.sections.map((s: any) => ({
                  title: render(s.title, 24),
                  rows: s.rows.map((c: any) => ({
                    id: c.id,
                    title: render(c.title, 24),
                    ...(c.description ? { description: render(c.description, 72) } : {}),
                  })),
                })),
              },
      };
      messages.push({ nodeId: id, type: 'interactive', interactive });
    } else
      messages.push({
        nodeId: id,
        type: 'text',
        text: {
          body: render(
            node.type === 'custom_field' ? node.payload.question_text : node.payload.text,
          ),
          preview_url: false,
        },
      });
    if (['question', 'interactive', 'custom_field'].includes(node.type))
      return { state: { nodeId: id, waiting: true, variables, activeMenus }, messages };
    id = node.next_node;
  }
  return { state: { nodeId: null, waiting: false, variables }, messages };
}
