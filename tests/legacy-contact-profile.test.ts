import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/whatsapp/contact';
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const contact = await db.contacts.create({
    data: { vendorId: f.vendorId, assignedUserId: f.userId, data: { preserved: 'yes' } },
  });
  const label = await db.labels.create({
    data: {
      vendorId: f.vendorId,
      title: 'Priority',
      status: 1,
      textColor: '#ffffff',
      bgColor: '#000000',
    },
  });
  const call = (method: 'get' | 'post', path: string, body?: Record<string, unknown>) => {
    const req = request(app)[method](`${base}${path}`).set('Authorization', `Bearer ${f.token}`);
    return body === undefined ? req : req.send(body);
  };
  return { ...f, contact, label, call };
}
describe('original contact note and label URL adapters', () => {
  it('updates and clears source-named notes while preserving other contact data', async () => {
    const f = await fixture();
    expect(
      (
        await f.call('post', '/chat/update-notes', {
          contactIdOrUid: f.contact.uid,
          contact_notes: 'Customer requested a callback',
        })
      ).status,
    ).toBe(200);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).data,
    ).toMatchObject({ preserved: 'yes', contact_notes: 'Customer requested a callback' });
    expect(
      (await f.call('post', '/chat/update-notes', { contactIdOrUid: f.contact.uid })).status,
    ).toBe(200);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).data,
    ).toMatchObject({ preserved: 'yes', contact_notes: '' });
  });
  it('replaces assignments atomically and accepts omitted or null source selection as clearing labels', async () => {
    const f = await fixture();
    for (const selected of [[f.label.id], [], [f.label.id], null, [f.label.id], undefined]) {
      const body = {
        contactUid: f.contact.uid,
        ...(selected === undefined ? {} : { contact_labels: selected }),
      };
      expect((await f.call('post', '/chat/assign-labels', body)).status).toBe(200);
      expect(await db.contactLabels.count({ where: { contactId: f.contact.id } })).toBe(
        selected?.length ?? 0,
      );
    }
  });
  it('returns the source listOfAllLabels catalog rather than only assigned labels, with bounded pages', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.labels.create({ data: { vendorId: f.vendorId, title: 'Second', status: 1 } });
    const result = await f.call('get', `/labels/${f.contact.uid}`).query({ page: 1, limit: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      contact_uid: f.contact.uid,
      total: 2,
      page: 1,
      limit: 1,
      has_more: true,
    });
    expect(result.body.listOfAllLabels).toEqual([
      {
        _id: f.label.id,
        _uid: f.label.uid,
        title: 'Priority',
        text_color: '#ffffff',
        bg_color: '#000000',
        status: 1,
      },
    ]);
    expect(
      (await f.call('get', `/labels/${f.contact.uid}`).query({ page: 2, limit: 1 })).body.has_more,
    ).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain(other.label.uid);
  });
  it('rejects foreign, inactive and duplicate labels without removing existing assignments', async () => {
    const f = await fixture(),
      other = await fixture();
    expect(
      (
        await f.call('post', '/chat/assign-labels', {
          contactUid: f.contact.uid,
          contact_labels: [f.label.id],
        })
      ).status,
    ).toBe(200);
    const inactive = await db.labels.create({
      data: { vendorId: f.vendorId, title: 'Archived', status: 2 },
    });
    for (const ids of [[other.label.id], [inactive.id], [f.label.id, f.label.id]]) {
      expect(
        (
          await f.call('post', '/chat/assign-labels', {
            contactUid: f.contact.uid,
            contact_labels: ids,
          })
        ).status,
      ).toBe(400);
      expect(
        (await db.contactLabels.findMany({ where: { contactId: f.contact.id } })).map(
          (row) => row.labelsId,
        ),
      ).toEqual([f.label.id]);
    }
  });
  it('enforces contact assignment and workspace ownership for reads and writes', async () => {
    const f = await fixture(['vendor.contacts.view', 'vendor.contacts.edit']),
      other = await fixture();
    const hidden = await db.contacts.create({ data: { vendorId: f.vendorId } });
    for (const uid of [hidden.uid, other.contact.uid]) {
      expect((await f.call('get', `/labels/${uid}`)).status).toBe(404);
      expect(
        (
          await f.call('post', '/chat/update-notes', {
            contactIdOrUid: uid,
            contact_notes: 'unauthorized',
          })
        ).status,
      ).toBe(404);
      expect(
        (await f.call('post', '/chat/assign-labels', { contactUid: uid, contact_labels: [] }))
          .status,
      ).toBe(404);
    }
    expect((await f.call('get', `/labels/${f.contact.uid}`)).status).toBe(200);
  });
  it('rejects unauthenticated or unauthorized writes and malformed source input', async () => {
    const f = await fixture(),
      viewer = await fixture(['vendor.contacts.view']);
    expect(
      (await request(app).post(`${base}/chat/update-notes`).send({ contactIdOrUid: f.contact.uid }))
        .status,
    ).toBe(401);
    expect(
      (await viewer.call('post', '/chat/update-notes', { contactIdOrUid: viewer.contact.uid }))
        .status,
    ).toBe(403);
    for (const body of [
      { contactIdOrUid: 12 },
      { contactIdOrUid: f.contact.uid, contact_notes: 'x'.repeat(10001) },
      { contactIdOrUid: f.contact.uid, vendors__id: f.vendorId },
      { contactIdOrUid: f.contact.uid, contact_notes: { value: 'not text' } },
    ]) {
      expect((await f.call('post', '/chat/update-notes', body)).status).toBe(400);
    }
    expect((await f.call('get', `/labels/${f.contact.uid}`).query({ limit: 101 })).status).toBe(
      400,
    );
  });
});
