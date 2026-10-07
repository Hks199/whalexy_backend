import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  prefix = '/vendor-console/bot-replies/bot-flows';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const f = await businessFixture(),
    phone = `6622${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-flow'),
    },
  });
  const created = await request(app)
    .post(`/api/v1/vendors/${f.vendorId}/bot-flows`)
    .set('Authorization', `Bearer ${f.token}`)
    .send({
      title: 'Flow',
      enabled: true,
      triggerType: 'is',
      startTrigger: 'hello',
      phoneNumberId: phone,
      graph: {
        start_node: 'start',
        nodes: [{ id: 'start', type: 'message', payload: { text: 'Hello' }, next_node: null }],
      },
    });
  expect(created.status).toBe(201);
  const post = (path: string, body: any = {}, key = randomUUID()) =>
    request(app)
      .post(`${prefix}/${path}`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (path: string, query = {}) =>
    request(app).get(`${prefix}/${path}`).set('Authorization', `Bearer ${f.token}`).query(query);
  return { ...f, phone, flow: created.body, post, get };
}
describe('original bot flow API adapters', () => {
  it('lists source fields, edits header data and exports a disabled importable native definition', async () => {
    const f = await fixture();
    const list = await f.get('list-data', {
      draw: 2,
      length: 1,
      'columns[0][data]': 'title',
      'order[0][column]': 0,
      'order[0][dir]': 'desc',
    });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ draw: 2, recordsTotal: 1, recordsFiltered: 1 });
    expect(list.body.data[0]).toMatchObject({
      _uid: f.flow.uid,
      title: 'Flow',
      channels: ['whatsapp'],
    });
    expect(list.body.data[0]).not.toHaveProperty('data');
    expect((await f.get(`${f.flow.uid}/get-update-data`)).body.data.start_trigger).toBe('hello');
    const exported = await f.get(`${f.flow.uid}/export`);
    expect(exported.status).toBe(200);
    expect(exported.body.enabled).toBe(false);
    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.body).not.toHaveProperty('vendorId');
    expect(
      (
        await request(app)
          .post(`/api/v1/vendors/${f.vendorId}/bot-flows/import`)
          .set('Authorization', `Bearer ${f.token}`)
          .send(exported.body)
      ).status,
    ).toBe(201);
  });
  it('clones one inactive graph with new flow identity and atomically replays', async () => {
    const f = await fixture(),
      key = randomUUID(),
      copy = await f.post(`${f.flow.uid}/clone-process`, {}, key);
    expect(copy.status).toBe(200);
    expect(copy.body.data.status).toBe('inactive');
    const cloned = await db.botFlows.findUniqueOrThrow({
      where: { uid: copy.body.data.botFlowUid },
    });
    expect((cloned.data as any).graph.flow_id).not.toBe((f.flow.data as any).graph.flow_id);
    expect((await f.post(`${f.flow.uid}/clone-process`, {}, key)).body).toEqual(copy.body);
    expect(await db.botFlows.count({ where: { vendorId: f.vendorId } })).toBe(2);
  });
  it('updates source header fields preserving graph and sender, then deletes idempotently', async () => {
    const f = await fixture(),
      body = {
        botFlowIdOrUid: f.flow.uid,
        title: 'Changed',
        trigger_type: 'welcome',
        start_trigger: '',
        status: 'on',
        channels: ['whatsapp'],
      },
      key = randomUUID();
    const updated = await f.post('update-process', body, key);
    expect(updated.status).toBe(200);
    const row = await db.botFlows.findUniqueOrThrow({ where: { id: f.flow.id } });
    expect(row.data).toEqual(f.flow.data);
    expect(row.title).toBe('Changed');
    expect((await f.post('update-process', { ...body, title: 'Different' }, key)).status).toBe(409);
    const deletionKey = randomUUID(),
      removed = await f.post(`${f.flow.id}/delete-process`, {}, deletionKey);
    expect(removed.status).toBe(200);
    expect((await f.post(`${f.flow.id}/delete-process`, {}, deletionKey)).body).toEqual(
      removed.body,
    );
    expect(await db.botFlows.findUnique({ where: { id: f.flow.id } })).toBeNull();
  });
  it('preserves imported builder, social, provider and linked bot configuration', async () => {
    const f = await fixture();
    for (const values of [
      { data: { flow_builder_data: { private: 'preserve' } } },
      { channels: ['instagram'] },
      { whatsappFlowId: 'published-flow' },
      { data: { ...f.flow.data, private: 'preserve' } },
    ]) {
      const imported = await db.botFlows.create({
        data: {
          vendorId: f.vendorId,
          title: 'Imported',
          triggerType: 'is',
          startTrigger: 'hello',
          channels: ['whatsapp'],
          data: f.flow.data,
          ...values,
        },
      });
      expect((await f.get(`${imported.uid}/get-update-data`)).status).toBe(200);
      expect(JSON.stringify((await f.get('list-data')).body)).not.toContain('preserve');
      for (const action of ['clone-process', 'delete-process'])
        expect((await f.post(`${imported.uid}/${action}`)).status).toBe(409);
      expect((await f.get(`${imported.uid}/export`)).status).toBe(409);
      expect(
        (
          await request(app)
            .delete(`/api/v1/vendors/${f.vendorId}/bot-flows/${imported.id}`)
            .set('Authorization', `Bearer ${f.token}`)
        ).status,
      ).toBe(409);
      expect((await db.botFlows.findUniqueOrThrow({ where: { id: imported.id } })).data).toEqual(
        imported.data,
      );
    }
    await db.botReplies.create({
      data: {
        vendorId: f.vendorId,
        botFlowsId: f.flow.id,
        name: 'Imported node',
        triggerType: 'is',
        priorityIndex: 2,
        status: 2,
      },
    });
    expect((await f.post(`${f.flow.uid}/delete-process`)).status).toBe(409);
  });
  it('rejects foreign targets, unsafe DataTables input, unsupported channels and missing keys', async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await f.get(`${other.flow.uid}/export`)).status).toBe(404);
    expect((await f.post(`${other.flow.id}/delete-process`)).status).toBe(404);
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
    expect(
      (
        await f.post('update-process', {
          botFlowIdOrUid: f.flow.uid,
          title: 'Changed',
          trigger_type: 'is',
          start_trigger: 'hi',
          channels: ['instagram'],
          status: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`${prefix}/${f.flow.uid}/clone-process`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({})
      ).status,
    ).toBe(400);
  });
  it('preserves imported/null session references, and removes only owned native sessions', async () => {
    const f = await fixture();
    for (const phoneNumber of [null, 'node:whatsapp:foreign:12345']) {
      const session = await db.userActiveFlows.create({ data: { flowId: f.flow.id, phoneNumber } });
      expect((await f.post(`${f.flow.uid}/delete-process`)).status).toBe(409);
      expect(await db.userActiveFlows.findUnique({ where: { id: session.id } })).not.toBeNull();
      await db.userActiveFlows.delete({ where: { id: session.id } });
    }
    const session = await db.userActiveFlows.create({
      data: { flowId: f.flow.id, phoneNumber: `node:whatsapp:${f.vendorId}:12345` },
    });
    expect((await f.post(`${f.flow.uid}/delete-process`)).status).toBe(200);
    expect(await db.userActiveFlows.findUnique({ where: { id: session.id } })).toBeNull();
  });
  it('rechecks permissions before replay and rolls back clone/audit/replay as one transaction', async () => {
    const f = await fixture(),
      key = randomUUID();
    expect((await f.post(`${f.flow.uid}/clone-process`, {}, key)).status).toBe(200);
    await db.nativeMemberships.updateMany({
      where: { vendorId: f.vendorId, userId: f.userId },
      data: { role: 'agent', permissions: [] },
    });
    expect((await f.post(`${f.flow.uid}/clone-process`, {}, key)).status).toBe(403);
    const g = await fixture(),
      transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options),
    );
    expect((await g.post(`${g.flow.uid}/clone-process`)).status).toBe(500);
    expect(await db.botFlows.count({ where: { vendorId: g.vendorId } })).toBe(1);
    expect(await db.nativeIdempotency.count({ where: { vendorId: g.vendorId } })).toBe(0);
  });
});
