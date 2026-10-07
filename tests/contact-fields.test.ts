import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  return {
    ...f,
    auth: `Bearer ${f.token}`,
    path: `/api/v1/vendors/${f.vendorId}/custom-fields`,
    alias: `/api/v1/vendors/${f.vendorId}/resources/custom-fields`,
  };
}
const create = (
  f: Awaited<ReturnType<typeof fixture>>,
  body: any = { inputName: 'company', inputType: 'text' },
  alias = false,
) =>
  request(app)
    .post(alias ? f.alias : f.path)
    .set('Authorization', f.auth)
    .send(body);
const patch = (f: Awaited<ReturnType<typeof fixture>>, field: any, changes: any, alias = false) =>
  request(app)
    .patch(`${alias ? f.alias : f.path}/${field.id}`)
    .set('Authorization', f.auth)
    .send({ revision: field.updatedAt, ...changes });
const remove = (f: Awaited<ReturnType<typeof fixture>>, field: any) =>
  request(app)
    .delete(`${f.path}/${field.id}`)
    .set('Authorization', f.auth)
    .send({ revision: field.updatedAt });

describe('native custom-field definition lifecycle', () => {
  it('creates, reads and edits owned fields through both native and prior resource paths', async () => {
    const f = await fixture(),
      created = await create(f, { inputName: 'company', inputType: 'text', name: 'Company' }, true);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      inputName: 'company',
      inputType: 'text',
      name: 'Company',
    });
    expect(created.body.vendorId).toBeUndefined();
    const updated = await patch(f, created.body, { name: 'Business' });
    expect(updated.status).toBe(200);
    expect(updated.body.updatedAt).not.toBe(created.body.updatedAt);
    const read = await request(app)
      .get(`${f.alias}/${created.body.id}`)
      .set('Authorization', f.auth);
    expect(read.body.name).toBe('Business');
    const list = await request(app).get(f.path).set('Authorization', f.auth);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(created.body.id);
    expect((await remove(f, updated.body)).status).toBe(204);
    expect(await db.contactCustomFields.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(
      (
        await db.auditEvents.findMany({
          where: { vendorId: f.vendorId, resource: 'contact-custom-field' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((e) => e.action),
    ).toEqual(['create', 'update', 'delete']);
  });
  it('rejects unsafe names, unsupported types, server fields and missing revisions', async () => {
    const f = await fixture();
    for (const body of [
      { inputName: '__proto__', inputType: 'text' },
      { inputName: 'vendorId', inputType: 'text' },
      { inputName: 'bad-name', inputType: 'text' },
      { inputName: 'company', inputType: 'select' },
      { inputName: 'company', inputType: 'text', vendorId: 999 },
      { inputName: 'company', inputType: 'text', status: 1 },
    ])
      expect((await create(f, body, true)).status).toBe(400);
    const created = (await create(f)).body;
    expect(
      (
        await request(app)
          .patch(`${f.alias}/${created.id}`)
          .set('Authorization', f.auth)
          .send({ inputType: 'number' })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).delete(`${f.path}/${created.id}`).set('Authorization', f.auth).send({}))
        .status,
    ).toBe(400);
    expect((await patch(f, created, {})).status).toBe(400);
  });
  it('enforces exact name uniqueness under concurrent creates and renames', async () => {
    const f = await fixture(),
      responses = await Promise.all([create(f), create(f, undefined, true)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const other = (await create(f, { inputName: 'other', inputType: 'text' })).body;
    expect((await patch(f, other, { inputName: 'company' }, true)).status).toBe(409);
    expect(
      await db.contactCustomFields.count({ where: { vendorId: f.vendorId, inputName: 'company' } }),
    ).toBe(1);
  });
  it('enforces the native field limit even across simultaneous resource aliases', async () => {
    const f = await fixture();
    await db.contactCustomFields.createMany({
      data: Array.from({ length: 99 }, (_, i) => ({
        vendorId: f.vendorId,
        inputName: `field_${i}`,
        inputType: 'text',
      })),
    });
    const replies = await Promise.all([
      create(f, { inputName: 'last_one', inputType: 'text' }),
      create(f, { inputName: 'last_two', inputType: 'text' }, true),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.contactCustomFields.count({ where: { vendorId: f.vendorId } })).toBe(100);
  });
  it('rejects foreign ownership, malformed IDs and revoked mutation permission', async () => {
    const f = await fixture(),
      other = await fixture(),
      own = (await create(f)).body,
      foreign = (await create(other)).body;
    expect((await patch(f, foreign, { name: 'Denied' })).status).toBe(404);
    expect((await remove(f, foreign)).status).toBe(404);
    expect((await request(app).get(`${f.path}/bad-id`).set('Authorization', f.auth)).status).toBe(
      400,
    );
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: f.userId } },
      data: { permissions: ['vendor.contacts.view'] },
    });
    expect((await patch(f, own, { name: 'Denied' })).status).toBe(403);
    expect((await create(f, { inputName: 'second', inputType: 'text' }, true)).status).toBe(403);
    expect((await request(app).get(f.path).set('Authorization', f.auth)).status).toBe(200);
  });
  it('rejects stale revisions and allows only one of two competing edits', async () => {
    const f = await fixture(),
      own = (await create(f)).body;
    const replies = await Promise.all([
      patch(f, own, { name: 'One' }),
      patch(f, own, { name: 'Two' }, true),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await remove(f, own)).status).toBe(409);
  });
  it('validates every existing value before changing type without rewriting source values', async () => {
    const f = await fixture(),
      own = (await create(f)).body,
      contact = await db.contacts.create({ data: { vendorId: f.vendorId, waId: '919876543210' } });
    const stored = await db.contactCustomFieldValues.create({
      data: { contactId: contact.id, contactCustomFieldsId: own.id, fieldValue: 'not numeric' },
    });
    expect((await patch(f, own, { inputType: 'number' })).status).toBe(409);
    await db.contactCustomFieldValues.update({
      where: { id: stored.id },
      data: { fieldValue: ' 9007199254740993 ' },
    });
    const changed = await patch(f, own, { inputType: 'number' });
    expect(changed.status).toBe(200);
    expect(
      (await db.contactCustomFieldValues.findUniqueOrThrow({ where: { id: stored.id } }))
        .fieldValue,
    ).toBe(' 9007199254740993 ');
    expect(
      (
        await request(app)
          .put(`/api/v1/vendors/${f.vendorId}/contacts/${contact.id}/custom-values`)
          .set('Authorization', f.auth)
          .send({ values: [{ fieldId: own.id, value: 'now-invalid' }] })
      ).status,
    ).toBe(400);
  });
  it('preserves populated values on delete and removes only cleared value rows', async () => {
    const f = await fixture(),
      own = (await create(f)).body,
      contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    await db.contactCustomFieldValues.create({
      data: { contactId: contact.id, contactCustomFieldsId: own.id, fieldValue: 'Private' },
    });
    expect((await remove(f, own)).status).toBe(409);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: contact.id } })).toBe(1);
    expect(
      (
        await request(app)
          .put(`/api/v1/vendors/${f.vendorId}/contacts/${contact.id}/custom-values`)
          .set('Authorization', f.auth)
          .send({ values: [{ fieldId: own.id, value: null }] })
      ).status,
    ).toBe(204);
    expect((await remove(f, own)).status).toBe(204);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: contact.id } })).toBe(0);
  });
  it.each(['question', 'template', 'standalone', 'campaign'])(
    'guards %s references while permitting display label edits',
    async (kind) => {
      const f = await fixture(),
        own = (await create(f)).body;
      if (kind === 'question' || kind === 'template')
        await db.botFlows.create({
          data: {
            vendorId: f.vendorId,
            title: 'Reference',
            triggerType: 'is',
            data: {
              graph: {
                nodes: [
                  {
                    payload:
                      kind === 'question'
                        ? { store_in_field: own.inputName }
                        : { bodyParameters: [{ customFieldId: own.id }] },
                  },
                ],
              },
            },
          },
        });
      if (kind === 'standalone')
        await db.botReplies.create({
          data: {
            vendorId: f.vendorId,
            triggerType: 'is',
            replyText: 'Hello {company}',
            status: 1,
            priorityIndex: 1,
          },
        });
      if (kind === 'campaign') {
        const template = await db.whatsappTemplates.create({
          data: {
            vendorId: f.vendorId,
            templateName: 'field_reference',
            languageCode: 'en',
            status: 'APPROVED',
          },
        });
        await db.campaigns.create({
          data: {
            vendorId: f.vendorId,
            title: 'Reference',
            templateId: template.id,
            status: 'draft',
            data: { bodyParameters: [{ customFieldId: own.id }] },
          },
        });
      }
      expect((await patch(f, own, { inputName: 'new_name' })).status).toBe(409);
      expect((await patch(f, own, { inputType: 'number' })).status).toBe(409);
      expect((await remove(f, own)).status).toBe(409);
      expect((await patch(f, own, { name: 'Display only' })).status).toBe(200);
    },
  );
  it('does not confuse another business reference with an owned unused field', async () => {
    const f = await fixture(),
      other = await fixture(),
      own = (await create(f)).body;
    await db.botFlows.create({
      data: {
        vendorId: other.vendorId,
        title: 'Foreign reference',
        triggerType: 'is',
        data: { question: { store_in_field: own.inputName } },
      },
    });
    expect((await patch(f, own, { inputName: 'renamed' })).status).toBe(200);
  });
  it('blocks corrupt cross-business value links without altering either organization', async () => {
    const f = await fixture(),
      other = await fixture(),
      own = (await create(f)).body;
    const foreign = await db.contacts.create({ data: { vendorId: other.vendorId } });
    const value = await db.contactCustomFieldValues.create({
      data: { contactId: foreign.id, contactCustomFieldsId: own.id, fieldValue: null },
    });
    expect((await remove(f, own)).status).toBe(409);
    expect((await patch(f, own, { inputName: 'renamed' })).status).toBe(409);
    expect(
      await db.contactCustomFieldValues.findUnique({ where: { id: value.id } }),
    ).not.toBeNull();
    expect(
      (await db.contactCustomFields.findUniqueOrThrow({ where: { id: own.id } })).inputName,
    ).toBe('company');
  });
  it('validates the committed answer after a concurrent field reader completes', async () => {
    const f = await fixture(),
      own = (await create(f)).body,
      contact = await db.contacts.create({ data: { vendorId: f.vendorId } });
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve)),
      locked = new Promise<void>((resolve) => (ready = resolve));
    const reader = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "_id" FROM "contact_custom_fields" WHERE "_id"=${own.id} FOR SHARE`;
      ready();
      await gate;
      await tx.contactCustomFieldValues.create({
        data: {
          contactId: contact.id,
          contactCustomFieldsId: own.id,
          fieldValue: 'invalid number',
        },
      });
    });
    await locked;
    const editing = patch(f, own, { inputType: 'number' }).then((response) => response);
    release();
    await reader;
    expect((await editing).status).toBe(409);
    expect(
      (await db.contactCustomFields.findUniqueOrThrow({ where: { id: own.id } })).inputType,
    ).toBe('text');
  });
});
