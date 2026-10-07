import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
import { encrypt } from '../src/utils/crypto.js';
const app = createApp();
function queryString(value: any) {
  const fields: Record<string, string> = {};
  function visit(v: any, key: string) {
    if (v && typeof v === 'object')
      for (const [part, item] of Object.entries(v)) visit(item, key ? `${key}[${part}]` : part);
    else fields[key] = String(v);
  }
  visit(value, '');
  return fields;
}
afterAll(() => db.$disconnect());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `8877${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test'),
    },
  });
  const template = await db.whatsappTemplates.create({
    data: {
      vendorId: f.vendorId,
      templateName: 'campaign_template',
      languageCode: 'en',
      status: 'APPROVED',
      category: 'UTILITY',
      data: { components: [{ type: 'BODY', text: 'Hello' }] },
    },
  });
  const campaign = await db.campaigns.create({
    data: {
      vendorId: f.vendorId,
      templateId: template.id,
      title: 'Campaign',
      status: 'awaiting_test',
      scheduledAt: new Date(Date.now() + 600000),
      data: {
        phoneNumberId: phone,
        allContacts: true,
        groupIds: [],
        phoneNumbers: [],
        requireTest: false,
        restrictLanguage: false,
        bodyParameters: [],
        headerParameters: [],
        private: 'private-campaign-state',
      },
    },
  });
  const action = (
    name: string,
    target: string | number = campaign.uid,
    key = randomUUID(),
    body = {},
  ) =>
    request(app)
      .post(`/vendor-console/whatsapp/campaign/${target}/${name}`)
      .set('Authorization', `Bearer ${f.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const read = (suffix: string, query = {}) =>
    request(app)
      .get(`/vendor-console/whatsapp/campaign/${suffix}`)
      .set('Authorization', `Bearer ${f.token}`)
      .query(queryString(query));
  return { ...f, phone, template, campaign, action, read };
}
async function history(f: Awaited<ReturnType<typeof fixture>>, contactId?: number) {
  const contact = contactId
    ? await db.contacts.findUniqueOrThrow({ where: { id: contactId } })
    : await db.contacts.create({
        data: {
          vendorId: f.vendorId,
          firstName: 'Person',
          lastName: 'One',
          waId: `9199${f.vendorId}`,
        },
      });
  const queue = await db.whatsappMessageQueue.create({
    data: {
      vendorId: f.vendorId,
      campaignId: f.campaign.id,
      contactId: contact.id,
      phoneWithCountryCode: contact.waId!,
      status: 2,
      scheduledAt: new Date(),
      data: { error: 'private-provider-error' },
    },
  });
  const log = await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      campaignId: f.campaign.id,
      contactId: contact.id,
      contactWaId: contact.waId,
      type: 'template',
      status: 'read',
      isIncomingMessage: false,
      messagedAt: new Date(),
      data: { token: 'private-provider-token' },
    },
  });
  return { contact, queue, log };
}
describe('original campaign lifecycle and history adapters', () => {
  it('duplicates a native campaign once, strips history and requires a new test before sending', async () => {
    const f = await fixture(),
      key = randomUUID(),
      remote = vi.fn();
    vi.stubGlobal('fetch', remote);
    const first = await f.action('duplicate', f.campaign.uid, key);
    expect(first.status).toBe(200);
    expect(first.body.reaction).toBe(1);
    expect(first.body.data.status).toBe('awaiting_test');
    const copy = await db.campaigns.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(copy.title).toBe('Campaign - clone');
    expect(copy.data).toMatchObject({ requireTest: true });
    expect(copy.data).not.toHaveProperty('private');
    expect((await f.action('duplicate', f.campaign.uid, key)).body).toEqual(first.body);
    expect(await db.campaigns.count({ where: { vendorId: f.vendorId } })).toBe(2);
    expect((await f.action('duplicate', f.campaign.uid, key, { title: 'Changed' })).status).toBe(
      409,
    );
    expect(await db.outboxJobs.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(remote).not.toHaveBeenCalled();
  });
  it('archives only terminal campaigns and restores their previous stopped state through shared native logic', async () => {
    const f = await fixture();
    expect((await f.action('archive-process')).status).toBe(409);
    await db.campaigns.update({ where: { id: f.campaign.id }, data: { status: 'cancelled' } });
    const key = randomUUID();
    expect((await f.action('archive-process', f.campaign.id, key)).status).toBe(200);
    expect((await f.action('archive-process', f.campaign.id, key)).status).toBe(200);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id: f.campaign.id } })).status).toBe(
      'archived',
    );
    expect((await f.action('unarchive-process')).status).toBe(200);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id: f.campaign.id } })).status).toBe(
      'cancelled',
    );
    expect(
      await db.auditEvents.count({ where: { vendorId: f.vendorId, resource: 'campaign' } }),
    ).toBe(2);
  });
  it('deletes only stopped campaigns without queue, message, test or job history and supports native DELETE', async () => {
    const f = await fixture(),
      key = randomUUID();
    expect((await f.action('delete-process', f.campaign.uid, key)).status).toBe(200);
    expect(await db.campaigns.findUnique({ where: { id: f.campaign.id } })).toBeNull();
    expect((await f.action('delete-process', f.campaign.uid, key)).status).toBe(200);
    for (const kind of ['queue', 'log', 'job']) {
      const owned = await fixture();
      const recipient = await db.contacts.create({
        data: { vendorId: owned.vendorId, waId: '919123456789' },
      });
      if (kind === 'queue')
        await db.whatsappMessageQueue.create({
          data: {
            vendorId: owned.vendorId,
            campaignId: owned.campaign.id,
            phoneWithCountryCode: '919123456789',
            scheduledAt: new Date(),
          },
        });
      if (kind === 'log')
        await db.whatsappMessageLogs.create({
          data: {
            vendorId: owned.vendorId,
            contactId: recipient.id,
            type: 'template',
            status: 'uncertain',
            isIncomingMessage: false,
            messagedAt: new Date(),
            data: { campaignTestId: owned.campaign.id },
          },
        });
      if (kind === 'job')
        await db.outboxJobs.create({
          data: {
            vendorId: owned.vendorId,
            kind: 'whatsapp-send',
            status: 'uncertain',
            payload: { campaignId: owned.campaign.id },
          },
        });
      expect((await owned.action('delete-process')).status).toBe(409);
      expect(await db.campaigns.findUnique({ where: { id: owned.campaign.id } })).not.toBeNull();
    }
    const native = await fixture();
    expect(
      (
        await request(app)
          .delete(`/api/v1/vendors/${native.vendorId}/campaigns/${native.campaign.id}`)
          .set('Authorization', `Bearer ${native.token}`)
      ).status,
    ).toBe(204);
  });
  it('blocks archiving in-progress sends and rejects foreign, malformed and legacy-only duplication configuration', async () => {
    const f = await fixture(),
      other = await fixture();
    expect((await f.action('duplicate', other.campaign.uid)).status).toBe(404);
    await db.campaigns.update({ where: { id: f.campaign.id }, data: { status: 'completed' } });
    await db.outboxJobs.create({
      data: {
        vendorId: f.vendorId,
        kind: 'whatsapp-send',
        status: 'processing',
        payload: { campaignTestId: f.campaign.id },
      },
    });
    expect((await f.action('archive-process')).status).toBe(409);
    await db.campaigns.update({
      where: { id: f.campaign.id },
      data: { data: { campaign_recreate_payload: { token: 'private' } } },
    });
    expect((await f.action('duplicate')).status).toBe(409);
  });
  it('returns bounded safe source projections for lists, status, queue and executed history', async () => {
    const f = await fixture(),
      h = await history(f),
      remote = vi.fn();
    vi.stubGlobal('fetch', remote);
    const directory = await f.read('active/list-data', { draw: 7, start: 0, length: 1 });
    expect(directory.status).toBe(200);
    expect(directory.body).toMatchObject({ draw: 7, recordsTotal: 1, recordsFiltered: 1 });
    expect(directory.body.data[0]._uid).toBe(f.campaign.uid);
    expect(
      (await f.read('active/list-data', { search: { value: '%' } })).body.recordsFiltered,
    ).toBe(0);
    expect(
      (
        await f.read('active/list-data', {
          columns: [{ data: '__proto__' }],
          order: [{ column: 0, dir: 'asc' }],
        })
      ).status,
    ).toBe(400);
    const sorted = await f.read('active/list-data', {
      columns: [{ data: 'title', orderable: true }],
      order: [{ column: 0, dir: 'asc' }],
    });
    expect(sorted.status).toBe(200);
    const status = await f.read(`status/${f.campaign.uid}/data`);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({
      campaignStatus: 'awaiting_test',
      queueFailedCount: 1,
    });
    const queue = await f.read(`queue/${f.campaign.uid}`, { status: '2', length: 1 });
    expect(queue.status).toBe(200);
    expect(queue.body.data[0]).toMatchObject({
      _uid: h.queue.uid,
      full_name: 'Person One',
      phone_with_country_code: h.contact.waId,
    });
    const executed = await f.read(`executed/${f.campaign.uid}`, { status: 'read' });
    expect(executed.status).toBe(200);
    expect(executed.body.data[0]._uid).toBe(h.log.uid);
    for (const r of [directory, status, queue, executed])
      expect(JSON.stringify(r.body)).not.toContain('private-');
    expect(remote).not.toHaveBeenCalled();
  });
  it('masks phones with fresh permissions and excludes foreign imported relationships and incoming messages', async () => {
    const f = await fixture(['vendor.campaigns.view', 'vendor.chats.view_all']),
      other = await fixture();
    await history(f);
    const foreign = await db.contacts.create({
      data: { vendorId: other.vendorId, waId: '919123456789' },
    });
    await history(f, foreign.id);
    await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: foreign.id,
        campaignId: f.campaign.id,
        type: 'text',
        status: 'received',
        isIncomingMessage: true,
        messagedAt: new Date(),
      },
    });
    const queue = await f.read(`queue/${f.campaign.uid}`);
    expect(queue.body.recordsTotal).toBe(1);
    expect(queue.body.data[0].phone_with_country_code).toMatch(/^\*\*\*/);
    const logs = await f.read(`executed/${f.campaign.uid}`);
    expect(logs.body.recordsTotal).toBe(1);
    expect(logs.body.data[0].contact_wa_id).toMatch(/^\*\*\*/);
    expect((await f.read(`queue/${f.campaign.uid}`, { search: { value: '919' } })).status).toBe(
      403,
    );
    expect(
      (
        await f.read(`queue/${f.campaign.uid}`, {
          columns: [{ data: 'phone_with_country_code' }],
          order: [{ column: 0, dir: 'asc' }],
        })
      ).status,
    ).toBe(403);
    expect((await f.read(`status/${other.campaign.uid}/data`)).status).toBe(404);
  });
  it('rolls back lifecycle state and idempotency if the final audit fails', async () => {
    const f = await fixture();
    await db.campaigns.update({ where: { id: f.campaign.id }, data: { status: 'cancelled' } });
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: any, options: any) =>
      transaction(async (tx) => {
        tx.auditEvents.create = (() => Promise.reject(new Error('audit failed'))) as any;
        return fn(tx);
      }, options)) as any);
    expect((await f.action('archive-process')).status).toBe(500);
    expect((await db.campaigns.findUniqueOrThrow({ where: { id: f.campaign.id } })).status).toBe(
      'cancelled',
    );
    expect(await db.nativeIdempotency.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
  it('enforces fresh action/full visibility permission, strict DataTables input, identities and idempotency', async () => {
    const denied = await fixture(['vendor.campaigns.view']),
      f = await fixture();
    expect((await denied.read('active/list-data')).status).toBe(403);
    expect((await f.action('duplicate', 'invalid')).status).toBe(400);
    expect((await f.read(`queue/${f.campaign.uid}`, { length: 101 })).status).toBe(400);
    expect((await f.read(`queue/${f.campaign.uid}`, { status: 'invalid' })).status).toBe(400);
    const path = `/vendor-console/whatsapp/campaign/${f.campaign.uid}/duplicate`;
    expect(
      (await request(app).post(path).set('Authorization', `Bearer ${f.token}`).send({})).status,
    ).toBe(400);
    expect(
      (await request(app).get('/vendor-console/whatsapp/campaign/active/list-data')).status,
    ).toBe(401);
    await db.nativeMemberships.updateMany({
      where: { vendorId: f.vendorId, userId: f.userId },
      data: { role: 'agent', permissions: [] },
    });
    expect((await f.action('duplicate')).status).toBe(403);
    expect((await f.read('active/list-data')).status).toBe(403);
  });
});
