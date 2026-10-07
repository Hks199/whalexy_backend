import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  classification = '/vendor-console/whatsapp/chat/classification',
  cx = '/vendor-console/cx-analytics';
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    contact = await db.contacts.create({
      data: {
        vendorId: f.vendorId,
        assignedUserId: permissions.includes('*') ? null : f.userId,
        firstName: 'Customer',
      },
    });
  const auth = { Authorization: `Bearer ${f.token}` };
  return { ...f, contact, auth };
}
describe('original classification and CX JSON adapters', () => {
  it('maps classification defaults, tag fields and audited updates with replay-safe no-op writes', async () => {
    const f = await fixture();
    const initial = await request(app).get(`${classification}/logs/${f.contact.uid}`).set(f.auth);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({
      reaction: 1,
      data: {
        classification: {
          intent: 'New Inquiry',
          sentiment: 'Positive',
          urgency: 'Medium',
          risk_level: 'Low Risk',
        },
        customTags: [],
        logs: [],
      },
    });
    expect(initial.body.data.presets.intent.Sales['Demo Request'].color).toBe('#8b5cf6');
    const created = await request(app)
      .post(classification + '/tag/create')
      .set(f.auth)
      .send({ type: 'intent', name: 'Needs review' });
    expect(created.status).toBe(200);
    expect(created.body.data.tag).toMatchObject({
      _uid: expect.any(String),
      vendors__id: f.vendorId,
      type: 'intent',
      name: 'Needs review',
      color: '#64748b',
      icon: 'fa-tag',
      category: 'Custom',
    });
    expect(created.body.data.customTags).toHaveLength(1);
    const body = { contact_uid: f.contact.uid, attribute: 'intent', value: 'Needs review' };
    for (let i = 0; i < 2; i++) {
      const updated = await request(app)
        .post(classification + '/update')
        .set(f.auth)
        .send(body);
      expect(updated.status).toBe(200);
      expect(updated.body.data.classification.intent).toBe('Needs review');
      expect(updated.body.data.logs).toHaveLength(1);
      expect(updated.body.data.logs[0]).toMatchObject({
        type: 'Intent',
        old_value: 'None',
        new_value: 'Needs review',
        changed_by: 'Test user',
        formatted_time: expect.any(String),
      });
    }
    expect(
      await db.conversationClassificationLogs.count({
        where: { vendorId: f.vendorId, contactId: f.contact.id },
      }),
    ).toBe(1);
    expect(
      (
        await request(app)
          .post(classification + '/tag/create')
          .set(f.auth)
          .send({ type: 'intent', name: 'Needs review' })
      ).status,
    ).toBe(409);
  });
  it('rejects foreign tags/contacts and unsafe tag metadata without partial mutations', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.conversationClassificationTags.create({
      data: { vendorId: other.vendorId, type: 'intent', name: 'Foreign' },
    });
    const send = (body: any) =>
      request(app)
        .post(classification + '/update')
        .set(f.auth)
        .send(body);
    expect(
      (await send({ contact_uid: f.contact.uid, attribute: 'intent', value: 'Foreign' })).status,
    ).toBe(400);
    expect(
      (await send({ contact_uid: other.contact.uid, attribute: 'urgency', value: 'High' })).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${classification}/logs/${other.contact.uid}`)
          .set(f.auth)
          .send({ contact_uid: f.contact.uid })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(classification + '/tag/create')
          .set(f.auth)
          .send({ type: 'intent', name: 'Unsafe', icon: '<script>' })
      ).status,
    ).toBe(400);
    expect(
      (await send({ contact_uid: f.contact.uid, attribute: 'other', value: 'High' })).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(classification + '/logs/not-a-uuid')
          .set(f.auth)
      ).status,
    ).toBe(400);
    expect(await db.conversationClassifications.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.conversationClassificationLogs.count({ where: { vendorId: f.vendorId } })).toBe(
      0,
    );
  });
  it('enforces permissions, selected workspace and assigned conversation visibility', async () => {
    const f = await fixture(),
      reader = await fixture(['vendor.cx.view']);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: reader.userId,
        role: 'agent',
        permissions: ['vendor.cx.view'],
      },
    });
    const read = (uid: string, select = true) => {
      const r = request(app)
        .get(classification + '/logs/' + uid)
        .set(reader.auth);
      return select ? r.set('X-Vendor-Id', String(f.vendorId)) : r;
    };
    expect((await read(f.contact.uid, false)).status).toBe(409);
    expect((await read(f.contact.uid)).status).toBe(404);
    await db.contacts.update({
      where: { id: f.contact.id },
      data: { assignedUserId: reader.userId },
    });
    expect((await read(f.contact.uid)).status).toBe(200);
    expect(
      (
        await request(app)
          .post(classification + '/update')
          .set(reader.auth)
          .set('X-Vendor-Id', String(f.vendorId))
          .send({ contact_uid: f.contact.uid, attribute: 'urgency', value: 'High' })
      ).status,
    ).toBe(403);
    expect((await request(app).get(classification + '/logs/' + f.contact.uid)).status).toBe(401);
  });
  it('limits original history to 30 safe entries and does not reveal foreign actor details or tag data', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.conversationClassificationLogs.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        vendorId: f.vendorId,
        contactId: f.contact.id,
        type: 'risk_level',
        newValue: `Value ${i}`,
        changedByUsersId: other.userId,
      })),
    });
    await db.conversationClassificationTags.create({
      data: {
        vendorId: f.vendorId,
        type: 'intent',
        name: 'Safe',
        data: { secret: 'private-tag-secret' },
      },
    });
    const result = await request(app).get(`${classification}/logs/${f.contact.uid}`).set(f.auth);
    expect(result.body.data.logs).toHaveLength(30);
    expect(result.body.data.logs[0]).toMatchObject({
      type: 'Risk level',
      new_value: 'Value 34',
      changed_by: 'System/Agent',
    });
    expect(JSON.stringify(result.body)).not.toContain('private-tag-secret');
  });
  it('returns the latest or explicitly selected owned score by numeric or UUID conversation', async () => {
    const f = await fixture(),
      other = await fixture();
    const noScore = await request(app).get(`${cx}/conversations/${f.contact.uid}`).set(f.auth);
    expect(noScore.body).toEqual({ status: 'not_resolved', analysis: null });
    const first = await db.conversationCxScores.create({
      data: {
        vendorId: f.vendorId,
        conversationId: f.contact.id,
        resolutionSequence: 1,
        status: 'completed',
        cxScore: '9.2500',
        reasonJson: ['Resolved'],
        summary: 'Good',
      },
    });
    const latest = await db.conversationCxScores.create({
      data: {
        vendorId: f.vendorId,
        conversationId: f.contact.id,
        resolutionSequence: 2,
        status: 'failed',
        failureMessage: 'private-provider-message',
      },
    });
    for (const identifier of [f.contact.uid, f.contact.id]) {
      const result = await request(app).get(`${cx}/conversations/${identifier}`).set(f.auth);
      expect(result.status).toBe(200);
      expect(result.body.analysis).toMatchObject({
        id: latest.id,
        conversation_id: f.contact.id,
        resolution_sequence: 2,
        failure_message: 'CX analysis is unavailable',
      });
      expect(JSON.stringify(result.body)).not.toContain('private-provider-message');
    }
    const selected = await request(app)
      .get(`${cx}/conversations/${f.contact.uid}`)
      .set(f.auth)
      .query({ score: first.id });
    expect(selected.body.analysis).toMatchObject({
      id: first.id,
      cx_score: 9.25,
      reason_json: ['Resolved'],
    });
    expect(
      (await request(app).get(`${cx}/conversations/${other.contact.uid}`).set(f.auth)).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${cx}/conversations/${other.contact.uid}`)
          .set(other.auth)
          .query({ score: first.id })
      ).status,
    ).toBe(404);
  });
  it('serializes retry requests and rejects completed/uncertain effects on the original URL', async () => {
    const f = await fixture();
    const score = await db.conversationCxScores.create({
      data: {
        vendorId: f.vendorId,
        conversationId: f.contact.id,
        status: 'failed',
        failureMessage: 'old',
      },
    });
    const retry = () => request(app).post(`${cx}/scores/${score.id}/retry`).set(f.auth).send({});
    const results = await Promise.all([retry(), retry()]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
    expect(results[0].body).toEqual({
      status: 'pending',
      message: 'CX analysis queued for retry.',
    });
    const jobs = await db.outboxJobs.findMany({
      where: {
        vendorId: f.vendorId,
        kind: 'cx-score',
        status: 'pending',
        payload: { path: ['scoreId'], equals: score.id },
      },
    });
    expect(jobs).toHaveLength(1);
    for (const status of ['completed', 'uncertain', 'processing']) {
      await db.conversationCxScores.update({ where: { id: score.id }, data: { status } });
      expect((await retry()).status).toBe(409);
    }
    const other = await fixture();
    expect(
      (await request(app).post(`${cx}/scores/${score.id}/retry`).set(other.auth).send({})).status,
    ).toBe(404);
    expect(
      (await request(app).post(`${cx}/scores/not-a-number/retry`).set(f.auth).send({})).status,
    ).toBe(400);
  });
});
