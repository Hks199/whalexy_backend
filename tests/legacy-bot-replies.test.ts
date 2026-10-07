import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  prefix = '/vendor-console/bot-replies';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const f = await businessFixture();
  const post = (path: string, body = {}, key = randomUUID()) =>
    request(app)
      .post(`${prefix}/${path}`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (path: string, query = {}) =>
    request(app).get(`${prefix}/${path}`).set('Authorization', `Bearer ${f.token}`).query(query);
  return { ...f, post, get };
}
const body = {
  name: 'Hello',
  trigger_type: 'is',
  reply_trigger: 'hello',
  reply_text: 'Hello {first_name}',
  status: 'on',
};
describe('legacy standalone bot reply adapters', () => {
  it('creates, edits and deletes using original names with idempotent replay', async () => {
    const f = await fixture(),
      key = randomUUID();
    const created = await f.post('add-process', body, key);
    expect(created.status).toBe(200);
    expect(created.body.reaction).toBe(1);
    const bot = created.body.data;
    expect(bot.status).toBe(1);
    expect((await f.post('add-process', body, key)).body).toEqual(created.body);
    expect((await f.post('add-process', { ...body, name: 'Other' }, key)).status).toBe(409);
    expect((await f.get(`${bot._uid}/get-update-data`)).body.data.message_type).toBe('simple');
    const updated = await f.post('update-process', {
      ...body,
      botReplyIdOrUid: bot._uid,
      reply_text: 'Updated',
      status: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ reply_text: 'Updated', status: 2 });
    const deleteKey = randomUUID(),
      removed = await f.post(`${bot._id}/delete-process`, {}, deleteKey);
    expect(removed.status).toBe(200);
    expect((await f.post(`${bot._id}/delete-process`, {}, deleteKey)).body).toEqual(removed.body);
    expect(await db.botReplies.findUnique({ where: { id: bot._id } })).toBeNull();
  });
  it('duplicates into a distinct disabled reply and replays without a second copy', async () => {
    const f = await fixture(),
      created = await f.post('add-process', body),
      key = randomUUID();
    const copy = await f.post(`${created.body.data._uid}/duplicate-process`, {}, key);
    expect(copy.status).toBe(200);
    expect(copy.body.data.status).toBe(2);
    expect(copy.body.data._uid).not.toBe(created.body.data._uid);
    expect((await f.post(`${created.body.data._uid}/duplicate-process`, {}, key)).body).toEqual(
      copy.body,
    );
    expect(await db.botReplies.count({ where: { vendorId: f.vendorId } })).toBe(2);
  });
  it('returns bounded tenant-scoped DataTables records with literal search and supported sorting', async () => {
    const f = await fixture(),
      other = await fixture();
    await f.post('add-process', { ...body, name: '100% reply' });
    await f.post('add-process', { ...body, name: 'Second' });
    await other.post('add-process', { ...body, name: 'Foreign%' });
    const listed = await f.get('list-data', {
      'search[value]': '%',
      draw: 4,
      length: 1,
      'columns[0][data]': 'name',
      'order[0][column]': 0,
      'order[0][dir]': 'asc',
    });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ draw: 4, recordsTotal: 2, recordsFiltered: 1 });
    expect(listed.body.data[0].name).toBe('100% reply');
    expect(listed.body.data[0]).not.toHaveProperty('data');
    expect((await f.get('list-data', { length: -1 })).status).toBe(400);
    expect(
      (
        await f.get('list-data', {
          'columns[0][data]': '__proto__',
          'order[0][column]': 0,
          'order[0][dir]': 'asc',
        })
      ).status,
    ).toBe(400);
  });
  it('rejects foreign targets and graph nodes', async () => {
    const f = await fixture(),
      other = await fixture(),
      foreign = await other.post('add-process', body);
    expect((await f.get(`${foreign.body.data._uid}/get-update-data`)).status).toBe(404);
    expect((await f.post(`${foreign.body.data._id}/delete-process`)).status).toBe(404);
    const graph = await db.botReplies.create({
      data: {
        vendorId: f.vendorId,
        botFlowsId: 123,
        name: 'Node',
        triggerType: 'is',
        priorityIndex: 2,
        status: 2,
      },
    });
    expect((await f.post(`${graph.uid}/duplicate-process`)).status).toBe(404);
  });
  it('preserves imported rich metadata through both legacy and native edit paths', async () => {
    const f = await fixture(),
      bot = await db.botReplies.create({
        data: {
          vendorId: f.vendorId,
          name: 'Rich',
          triggerType: 'is',
          priorityIndex: 2,
          status: 2,
          data: { media_message: { private: 'keep' } },
        },
      });
    expect((await f.get(`${bot.uid}/get-update-data`)).status).toBe(409);
    expect((await f.post('update-process', { ...body, botReplyIdOrUid: bot.uid })).status).toBe(
      409,
    );
    expect((await f.post(`${bot.uid}/duplicate-process`)).status).toBe(409);
    expect((await f.post(`${bot.uid}/delete-process`)).status).toBe(409);
    expect(
      (
        await request(app)
          .put(`/api/v1/vendors/${f.vendorId}/bot-replies/${bot.id}`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({
            name: 'Changed',
            triggerType: 'is',
            replyTrigger: 'hello',
            replyText: 'Text',
            enabled: false,
          })
      ).status,
    ).toBe(409);
    expect((await db.botReplies.findUniqueOrThrow({ where: { id: bot.id } })).data).toEqual(
      bot.data,
    );
    expect(JSON.stringify((await f.get('list-data')).body)).not.toContain('keep');
  });
  it('rejects unsupported source workflows, malformed input and missing retry keys', async () => {
    const f = await fixture();
    for (const extra of [
      { message_type: 'media' },
      { bot_flow_uid: randomUUID() },
      { validate_bot_reply: true },
      { status: 2 },
      { phone_number_id: 'invalid' },
    ])
      expect((await f.post('add-process', { ...body, ...extra })).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`${prefix}/add-process`)
          .set('Authorization', `Bearer ${f.token}`)
          .send(body)
      ).status,
    ).toBe(400);
    expect(await db.botReplies.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('enforces current permissions even on replay and rolls back audit failures', async () => {
    const f = await fixture(),
      key = randomUUID();
    expect((await f.post('add-process', body, key)).status).toBe(200);
    await db.nativeMemberships.updateMany({
      where: { vendorId: f.vendorId, userId: f.userId },
      data: { role: 'agent', permissions: [] },
    });
    expect((await f.post('add-process', body, key)).status).toBe(403);
    expect((await f.get('list-data')).status).toBe(403);
    const g = await fixture(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options),
    );
    expect((await g.post('add-process', body)).status).toBe(500);
    expect(await db.botReplies.count({ where: { vendorId: g.vendorId } })).toBe(0);
    expect(await db.nativeIdempotency.count({ where: { vendorId: g.vendorId } })).toBe(0);
  });
  it('rejects unconnected senders and prevents deletion of referenced replies', async () => {
    const f = await fixture(),
      created = await f.post('add-process', body),
      bot = created.body.data;
    const child = await db.botReplies.create({
      data: {
        vendorId: f.vendorId,
        botRepliesId: bot._id,
        name: 'Child',
        triggerType: 'is',
        priorityIndex: 2,
        status: 2,
      },
    });
    expect((await f.post(`${bot._uid}/delete-process`)).status).toBe(409);
    await db.botReplies.delete({ where: { id: child.id } });
    expect(
      (
        await f.post('update-process', {
          ...body,
          botReplyIdOrUid: bot._uid,
          phone_number_id: '123456',
        })
      ).status,
    ).toBe(400);
    expect((await db.botReplies.findUniqueOrThrow({ where: { id: bot._id } })).replyText).toBe(
      body.reply_text,
    );
  });
});
