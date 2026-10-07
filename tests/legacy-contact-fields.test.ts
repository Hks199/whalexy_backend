import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/contacts/custom-fields';
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const call = (method: 'get' | 'post', path: string, body?: Record<string, unknown>) => {
    const req = request(app)[method](`${base}${path}`).set('Authorization', `Bearer ${f.token}`);
    return body === undefined ? req : req.send(body);
  };
  return {
    ...f,
    call,
    create: (name = 'company', type = 'text') =>
      call('post', '/add-process', { input_name: name, input_type: type }),
  };
}
describe('original custom-field URL adapters', () => {
  it('translates field names and handles owned numeric/UUID read, revision edit and deletion', async () => {
    const f = await fixture(),
      created = await f.create();
    expect(created.status).toBe(201);
    const field = created.body.field;
    expect(field).toMatchObject({ input_name: 'company', input_type: 'text' });
    expect(field.vendorId).toBeUndefined();
    expect(field.__data).toBeUndefined();
    for (const id of [field._id, field._uid]) {
      const show = await f.call('get', `/${id}/get-update-data`);
      expect(show.status).toBe(200);
      expect(show.body).toEqual(field);
    }
    const updated = await f.call('post', '/update-process', {
      contactCustomFieldIdOrUid: field._uid,
      input_name: 'organization',
      input_type: 'email',
      revision: field.updated_at,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.field.input_name).toBe('organization');
    expect(updated.body.field.updated_at).not.toBe(field.updated_at);
    const stale = await f.call('post', `/${field._uid}/delete-process`, {
      revision: field.updated_at,
    });
    expect(stale.status).toBe(409);
    expect(
      (
        await f.call('post', `/${field._id}/delete-process`, {
          revision: updated.body.field.updated_at,
        })
      ).status,
    ).toBe(200);
    expect((await f.call('get', `/${field._uid}/get-update-data`)).status).toBe(404);
    const audits = await db.auditEvents.findMany({
      where: { vendorId: f.vendorId, resource: 'contact-custom-field' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
  });
  it('paginates and searches only owned rows with the original DataTables field names', async () => {
    const f = await fixture(),
      other = await fixture();
    await f.create('apple');
    await f.create('zebra');
    await f.create('middle', 'number');
    await other.create('secret');
    const response = await f.call('get', '/list-data').query({
      draw: '7',
      start: '1',
      length: '1',
      'order[0][column]': '0',
      'order[0][dir]': 'desc',
      'columns[0][data]': 'input_name',
      'columns[0][search][value]': '',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ draw: 7, recordsTotal: 3, recordsFiltered: 3 });
    expect(response.body.data.map((row: any) => row.input_name)).toEqual(['middle']);
    const search = await f.call('get', '/list-data').query({ 'search[value]': 'NUM' });
    expect(search.status).toBe(200);
    expect(search.body.recordsFiltered).toBe(1);
    expect(search.body.data[0].input_name).toBe('middle');
    expect((await f.call('get', '/list-data').query({ start: 999 })).body.data).toEqual([]);
  });
  it('rejects unsupported query controls, unsafe names, unexpected fields and absent revisions', async () => {
    const f = await fixture();
    for (const body of [
      { input_name: '__proto__', input_type: 'text' },
      { input_name: 'vendorId', input_type: 'text' },
      { input_name: 'unsafe-name', input_type: 'text' },
      { input_name: 'company', input_type: 'select' },
      { input_name: 'company', input_type: 'text', vendors__id: f.vendorId },
    ]) {
      expect((await f.call('post', '/add-process', body)).status).toBe(400);
    }
    for (const query of [
      { length: -1 },
      { 'search[regex]': 'true' },
      { 'order[0][column]': '999' },
      { 'order[0][dir]': 'DROP' },
      { 'columns[0][search][value]': 'regex' },
      { rawSql: 'SELECT' },
    ]) {
      expect((await f.call('get', '/list-data').query(query)).status).toBe(400);
    }
    const field = (await f.create()).body.field;
    expect((await f.call('post', `/${field._uid}/delete-process`, {})).status).toBe(400);
    expect(
      (
        await f.call('post', '/update-process', {
          contactCustomFieldIdOrUid: field._uid,
          input_name: 'new_name',
          input_type: 'text',
        })
      ).status,
    ).toBe(400);
  });
  it('isolates workspaces and separates read and edit permissions', async () => {
    const f = await fixture(),
      other = await fixture(),
      viewer = await fixture(['vendor.contacts.view']);
    const field = (await f.create()).body.field;
    expect((await other.call('get', `/${field._uid}/get-update-data`)).status).toBe(404);
    expect(
      (
        await other.call('post', '/update-process', {
          contactCustomFieldIdOrUid: field._id,
          input_name: 'stolen',
          input_type: 'text',
          revision: field.updated_at,
        })
      ).status,
    ).toBe(404);
    expect(
      (await other.call('post', `/${field._uid}/delete-process`, { revision: field.updated_at }))
        .status,
    ).toBe(404);
    expect((await viewer.call('get', '/list-data')).status).toBe(200);
    expect((await viewer.create()).status).toBe(403);
    expect((await request(app).get(`${base}/list-data`)).status).toBe(401);
  });
  it('serializes duplicate creates through native and original endpoints', async () => {
    const f = await fixture();
    const responses = await Promise.all([
      f.create(),
      request(app)
        .post(`/api/v1/vendors/${f.vendorId}/custom-fields`)
        .set('Authorization', `Bearer ${f.token}`)
        .send({ inputName: 'company', inputType: 'text' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.contactCustomFields.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('preserves field references and rejects incompatible existing values and populated deletion', async () => {
    const f = await fixture(),
      field = (await f.create()).body.field;
    const contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    await db.contactCustomFieldValues.create({
      data: { contactId: contact.id, contactCustomFieldsId: field._id, fieldValue: 'not a number' },
    });
    expect(
      (
        await f.call('post', '/update-process', {
          contactCustomFieldIdOrUid: field._uid,
          input_name: 'company',
          input_type: 'number',
          revision: field.updated_at,
        })
      ).status,
    ).toBe(409);
    expect(
      (await f.call('post', `/${field._uid}/delete-process`, { revision: field.updated_at }))
        .status,
    ).toBe(409);
    await db.botReplies.create({
      data: {
        vendorId: f.vendorId,
        replyText: 'Hello {company}',
        status: 1,
        triggerType: 'is',
        priorityIndex: 1,
      },
    });
    expect(
      (
        await f.call('post', '/update-process', {
          contactCustomFieldIdOrUid: field._id,
          input_name: 'organization',
          input_type: 'text',
          revision: field.updated_at,
        })
      ).status,
    ).toBe(409);
    expect((await f.call('get', `/${field._id}/get-update-data`)).body.input_name).toBe('company');
  });
  it('retains native definition cap rather than claiming original subscription limits are verified', async () => {
    const f = await fixture();
    await db.contactCustomFields.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        vendorId: f.vendorId,
        inputName: `field_${i}`,
        inputType: 'text',
      })),
    });
    expect((await f.create()).status).toBe(409);
    expect(await db.contactCustomFields.count({ where: { vendorId: f.vendorId } })).toBe(100);
  });
});
