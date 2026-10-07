import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { advanceGraph } from '../src/modules/bot-flows/services/graph-execution.service.js';
import { validateGraph } from '../src/modules/bot-flows/services/graph-schema.validation.js';
import { type BotGraph } from '../src/modules/bot-flows/services/graph-types.types.js';
import { validQuestionAnswer } from '../src/modules/bot-flows/services/bot-question.js';
import { ingestMeta } from '../src/jobs/handlers/meta-webhook.handler.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
function graph(payload: any = {}): BotGraph {
  return {
    start_node: 'ask',
    nodes: [
      {
        id: 'ask',
        type: 'question',
        payload: { text: 'Your answer?', variable_name: 'answer', ...payload },
        next_node: 'fallback',
      },
      { id: 'matched', type: 'message', payload: { text: 'Matched {answer}' }, next_node: null },
      { id: 'fallback', type: 'message', payload: { text: 'Default {answer}' }, next_node: null },
    ],
  };
}
function answer(payload: any, value: string) {
  const g = validateGraph(graph(payload), true);
  return advanceGraph(g, advanceGraph(g, null, {}).state, { text: value });
}
async function fixture(type = 'email') {
  const f = await businessFixture(),
    phone = `7766${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-question'),
    },
  });
  const field = await db.contactCustomFields.create({
    data: { vendorId: f.vendorId, inputName: 'answer_field', inputType: type },
  });
  const contact = await db.contacts.create({
    data: { vendorId: f.vendorId, waId: `9199${String(f.vendorId).padStart(7, '0')}` },
  });
  return {
    ...f,
    phone,
    field,
    contact,
    auth: `Bearer ${f.token}`,
    path: `/api/v1/vendors/${f.vendorId}/bot-flows`,
  };
}
function inbound(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: f.phone },
              messages: [
                {
                  id: randomUUID(),
                  from: f.contact.waId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
function save(
  f: Awaited<ReturnType<typeof fixture>>,
  g = graph({ store_in_field: 'answer_field' }),
) {
  return request(app).post(f.path).set('Authorization', f.auth).send({
    title: 'Question',
    enabled: true,
    triggerType: 'is',
    startTrigger: 'hello',
    phoneNumberId: f.phone,
    graph: g,
  });
}
const queue = (f: Awaited<ReturnType<typeof fixture>>) =>
  db.outboxJobs.findMany({
    where: { vendorId: f.vendorId, kind: 'whatsapp-send' },
    orderBy: { createdAt: 'asc' },
  });

describe('question validation and conditional routing', () => {
  it.each(['equals', 'contains', 'starts_with'])(
    'normalizes %s conditions and uses the first match',
    (type) => {
      const value = type === 'equals' ? ' YES ' : 'YE';
      const result = answer(
        {
          conditional_flows: [
            { condition_type: type, condition_value: value, target_node: 'matched' },
            { condition_type: 'contains', condition_value: '', target_node: 'fallback' },
          ],
        },
        ' Yes ',
      );
      expect(result.messages[0].text.body).toBe('Matched Yes');
    },
  );
  it('routes unmatched answers to an explicit default and preserves terminal null branches', () => {
    expect(answer({ default_next_node: 'matched' }, 'x').messages[0].text.body).toBe('Matched x');
    expect(answer({ default_next_node: null }, 'x').messages).toEqual([]);
    expect(
      answer(
        {
          conditional_flows: [
            { condition_type: 'equals', condition_value: 'x', target_node: null },
          ],
        },
        'x',
      ).state.nodeId,
    ).toBeNull();
  });
  it.each(['1-10', '>=5', '<=5', '>4', '<6', '5'])('supports numeric condition %s', (range) => {
    expect(
      answer(
        {
          conditional_flows: [
            { condition_type: 'number_range', condition_value: range, target_node: 'matched' },
          ],
        },
        '5',
      ).messages[0].text.body,
    ).toBe('Matched 5');
    expect(
      answer(
        {
          conditional_flows: [
            { condition_type: 'number_range', condition_value: range, target_node: 'matched' },
          ],
        },
        'not numeric',
      ).messages[0].text.body,
    ).toBe('Default not numeric');
  });
  it('compares large decimal values without rounding distinct answers into the same branch', () => {
    const payload = {
      conditional_flows: [
        {
          condition_type: 'number_range',
          condition_value: '>9007199254740992',
          target_node: 'matched',
        },
      ],
    };
    expect(answer(payload, '9007199254740993').messages[0].text.body).toBe(
      'Matched 9007199254740993',
    );
    expect(answer(payload, '9007199254740992').messages[0].text.body).toBe(
      'Default 9007199254740992',
    );
  });
  it('rejects dangling condition/default edges, invalid ranges, regex and conflicting length rules', () => {
    for (const payload of [
      { default_next_node: 'missing' },
      {
        conditional_flows: [
          { condition_type: 'equals', condition_value: 'x', target_node: 'missing' },
        ],
      },
      {
        conditional_flows: [
          { condition_type: 'number_range', condition_value: '10-1', target_node: null },
        ],
      },
      {
        conditional_flows: [
          { condition_type: 'number_range', condition_value: 'garbage', target_node: null },
        ],
      },
      {
        conditional_flows: [
          { condition_type: 'regex', condition_value: '(a+)+', target_node: null },
        ],
      },
      { validation_rules: { min_length: 5, max_length: 3 } },
    ])
      expect(() => validateGraph(graph(payload), true)).toThrow();
  });
  it.each([
    ['number', '1.2e3', 'NaN'],
    ['email', 'a@example.com', 'bad-email'],
    ['url', 'https://example.com/x', 'javascript:alert(1)'],
    ['date', '2024-02-29', '2025-02-29'],
    ['time', '23:59:59', '24:99'],
    ['datetime-local', '2024-02-29T12:30', '2025-02-29T12:30'],
  ])('validates %s answers without changing state on failure', (type, good, bad) => {
    const g = validateGraph(graph({ input_type: type, error_message: 'Try again' })),
      initial = advanceGraph(g, null, {});
    const invalid = advanceGraph(g, initial.state, { text: bad });
    expect(invalid.state).toBe(initial.state);
    expect(invalid.messages[0].text.body).toBe('Try again');
    expect(advanceGraph(g, initial.state, { text: good }).messages[0].text.body).toBe(
      `Default ${good}`,
    );
  });
  it('counts Unicode characters, supports optional empty answers and leaves missing input alone', () => {
    const g = validateGraph(graph({ validation_rules: { min_length: 2, max_length: 2 } })),
      initial = advanceGraph(g, null, {});
    expect(advanceGraph(g, initial.state, { text: '😀😀' }).messages[0].text.body).toBe(
      'Default 😀😀',
    );
    expect(advanceGraph(g, initial.state, {}).state).toBe(initial.state);
    expect(answer({ is_required: false }, ' ').state.nodeId).toBeNull();
    expect(validQuestionAnswer(g.nodes[0], '😀')).toBe(false);
  });
});

describe('durable question field storage', () => {
  it('routes numeric answers and renders the newly captured value in a downstream template', async () => {
    const f = await fixture('number');
    const template = await db.whatsappTemplates.create({
      data: {
        vendorId: f.vendorId,
        templateName: 'new_answer',
        languageCode: 'en',
        status: 'APPROVED',
        category: 'UTILITY',
        data: { components: [{ type: 'BODY', text: 'Value {{1}}' }] },
      },
    });
    await db.contactCustomFieldValues.create({
      data: { contactId: f.contact.id, contactCustomFieldsId: f.field.id, fieldValue: 'old' },
    });
    const g = graph({
      store_in_field: 'answer_field',
      conditional_flows: [
        { condition_type: 'number_range', condition_value: '>=5', target_node: 'matched' },
      ],
    });
    g.nodes[1] = {
      id: 'matched',
      type: 'whatsapp_template',
      payload: {
        whatsapp_template_id: template.id,
        bodyParameters: [{ customFieldId: f.field.id }],
      },
      next_node: null,
    };
    expect((await save(f, g)).status).toBe(201);
    await ingestMeta(inbound(f, 'hello'));
    await ingestMeta(inbound(f, ' 5 '));
    expect((await queue(f))[1].payload).toMatchObject({
      payload: {
        template: { components: [{ type: 'body', parameters: [{ type: 'text', text: '5' }] }] },
      },
    });
    expect(
      await db.contactCustomFieldValues.findFirst({ where: { contactId: f.contact.id } }),
    ).toMatchObject({ fieldValue: '5' });
    await ingestMeta(inbound(f, 'hello'));
    await ingestMeta(inbound(f, '1'.repeat(2100)));
    expect(await queue(f)).toHaveLength(3);
    expect(
      await db.contactCustomFieldValues.findFirst({ where: { contactId: f.contact.id } }),
    ).toMatchObject({ fieldValue: '5' });
    expect(
      await db.outboxJobs.findFirst({ where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' } }),
    ).toMatchObject({ lastError: 'TEMPLATE_VALUE_INVALID' });
  });
  it('re-prompts invalid input, atomically stores a trimmed answer and deduplicates the receipt', async () => {
    const f = await fixture();
    expect((await save(f)).status).toBe(201);
    await ingestMeta(inbound(f, 'hello'));
    const invalid = inbound(f, 'bad-email');
    await ingestMeta(invalid);
    await ingestMeta(invalid);
    expect(await queue(f)).toHaveLength(2);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(0);
    const event = inbound(f, ' a@example.com ');
    await ingestMeta(event);
    await ingestMeta(event);
    expect(await queue(f)).toHaveLength(3);
    expect((await queue(f))[2].payload).toMatchObject({
      payload: { text: { body: 'Default a@example.com' } },
    });
    expect(
      await db.contactCustomFieldValues.findFirst({ where: { contactId: f.contact.id } }),
    ).toMatchObject({ contactCustomFieldsId: f.field.id, fieldValue: 'a@example.com' });
    expect(
      await db.auditEvents.count({
        where: { vendorId: f.vendorId, resource: 'contact-custom-value' },
      }),
    ).toBe(1);
    await ingestMeta(inbound(f, 'hello'));
    await ingestMeta(inbound(f, 'b@example.com'));
    expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(1);
    expect(
      await db.contactCustomFieldValues.findFirst({ where: { contactId: f.contact.id } }),
    ).toMatchObject({ fieldValue: 'b@example.com' });
  });
  it('uses the current field type for preview without writing answers or jobs', async () => {
    const f = await fixture(),
      created = await save(f);
    expect(created.status).toBe(201);
    const preview = await request(app)
      .post(`${f.path}/${created.body.id}/preview`)
      .set('Authorization', f.auth)
      .send({ inputs: [{ text: 'wrong' }, { text: 'a@example.com' }] });
    expect(preview.status).toBe(200);
    expect(preview.body.responses[1].state.nodeId).toBe('ask');
    expect(preview.body.completed).toBe(true);
    expect(await queue(f)).toHaveLength(0);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(0);
  });
  it('rejects foreign or ambiguous names and unsupported field types', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.contactCustomFields.update({ where: { id: f.field.id }, data: { inputType: 'text' } });
    expect(
      (
        await save(
          f,
          graph({ store_in_field: 'answer_field', validation_rules: { min_length: 501 } }),
        )
      ).status,
    ).toBe(400);
    await db.contactCustomFields.update({
      where: { id: f.field.id },
      data: { inputName: 'local_only' },
    });
    expect((await save(f)).status).toBe(400);
    await db.contactCustomFields.create({
      data: { vendorId: f.vendorId, inputName: 'local_only', inputType: 'email' },
    });
    expect((await save(f, graph({ store_in_field: 'local_only' }))).status).toBe(400);
    await db.contactCustomFields.update({
      where: { id: other.field.id },
      data: { inputType: 'select' },
    });
    expect((await save(other)).status).toBe(409);
  });
  it('blocks deleted field references without storing input or advancing the session', async () => {
    const f = await fixture();
    await save(f);
    await ingestMeta(inbound(f, 'hello'));
    await db.contactCustomFields.delete({ where: { id: f.field.id } });
    await ingestMeta(inbound(f, 'a@example.com'));
    expect(await queue(f)).toHaveLength(1);
    expect(
      await db.outboxJobs.findFirst({ where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' } }),
    ).toMatchObject({ lastError: 'GRAPH_FIELD_UNAVAILABLE' });
    expect(
      (
        await db.userActiveFlows.findFirst({
          where: {
            flowId: { not: null },
            phoneNumber: { startsWith: `node:whatsapp:${f.vendorId}:` },
          },
        })
      )?.currentNodeUid,
    ).toBe('ask');
  });
  it('does not store answers if downstream rendering fails', async () => {
    const f = await fixture('text'),
      g = graph({ store_in_field: 'answer_field' });
    g.nodes[2].payload.text = '{answer}{answer}';
    expect((await save(f, g)).status).toBe(201);
    await ingestMeta(inbound(f, 'hello'));
    await db.contactCustomFields.update({
      where: { id: f.field.id },
      data: { inputType: 'number' },
    });
    await ingestMeta(inbound(f, '1'.repeat(2100)));
    expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(0);
    expect(await queue(f)).toHaveLength(1);
    expect(
      await db.outboxJobs.findFirst({ where: { vendorId: f.vendorId, kind: 'bot-flow-blocked' } }),
    ).toMatchObject({ lastError: 'GRAPH_RENDER_INVALID' });
  });
});
