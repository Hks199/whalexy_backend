import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/contacts';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const groups = await Promise.all(
    ['First', 'Second'].map((title) =>
      db.contactGroups.create({ data: { vendorId: f.vendorId, title } }),
    ),
  );
  const field = await db.contactCustomFields.create({
    data: { vendorId: f.vendorId, inputName: randomUUID(), inputType: 'number', name: 'Count' },
  });
  const call = (path: string, body: Record<string, unknown>) =>
    request(app).post(`${base}/${path}`).set('Authorization', `Bearer ${f.token}`).send(body);
  const create = (body: Record<string, unknown> = {}) =>
    call('add-process', { phone_number: '919876543210', first_name: 'Original', ...body });
  const update = (uid: string, body: Record<string, unknown>) =>
    call('update-process', { contactIdOrUid: uid, ...body });
  return { ...f, groups, field, create, update };
}
describe('original contact create/update forms', () => {
  it('creates contact, selected groups and typed values in one audited transaction', async () => {
    const f = await fixture();
    const result = await f.create({
      contact_groups: [f.groups[0].id],
      custom_input_fields: { [f.field.uid]: ' 42 ' },
      whatsapp_opt_out: '1',
      enable_ai_bot: '0',
    });
    expect(result.status).toBe(201);
    const contact = await db.contacts.findUniqueOrThrow({
      where: { uid: result.body.contactIdOrUid },
    });
    expect(contact).toMatchObject({
      waId: '919876543210',
      firstName: 'Original',
      whatsappOptOut: 1,
      disableAiBot: 1,
      platform: 'whatsapp',
    });
    expect(await db.groupContacts.count({ where: { contactId: contact.id } })).toBe(1);
    expect(
      (await db.contactCustomFieldValues.findFirstOrThrow({ where: { contactId: contact.id } }))
        .fieldValue,
    ).toBe('42');
    expect(
      await db.auditEvents.count({
        where: { vendorId: f.vendorId, resource: 'contact', action: 'create' },
      }),
    ).toBe(1);
    expect(result.body.phone_number).toBeUndefined();
  });
  it('replaces explicit group selections, upserts/clears values and preserves omitted groups/AI/consent/private data', async () => {
    const f = await fixture(),
      created = await f.create({
        contact_groups: [f.groups[0].id],
        custom_input_fields: { [f.field.uid]: '12' },
        whatsapp_opt_out: true,
      });
    const uid = created.body.contactIdOrUid,
      contact = await db.contacts.findUniqueOrThrow({ where: { uid } });
    await db.contacts.update({
      where: { id: contact.id },
      data: { data: { internal: 'preserved' } },
    });
    expect((await f.update(uid, { first_name: 'Edited' })).status).toBe(200);
    expect(
      await db.groupContacts.count({ where: { contactId: contact.id, groupId: f.groups[0].id } }),
    ).toBe(1);
    expect(
      (
        await f.update(uid, {
          contact_groups: [f.groups[1].id],
          custom_input_fields: { [f.field.uid]: null },
          whatsapp_opt_out: false,
        })
      ).status,
    ).toBe(200);
    expect(
      await db.groupContacts.count({ where: { contactId: contact.id, groupId: f.groups[0].id } }),
    ).toBe(0);
    expect(
      await db.groupContacts.count({ where: { contactId: contact.id, groupId: f.groups[1].id } }),
    ).toBe(1);
    expect(
      (await db.contactCustomFieldValues.findFirstOrThrow({ where: { contactId: contact.id } }))
        .fieldValue,
    ).toBeNull();
    expect(await db.contacts.findUniqueOrThrow({ where: { uid } })).toMatchObject({
      firstName: 'Edited',
      whatsappOptOut: null,
      disableAiBot: 1,
      data: { internal: 'preserved' },
    });
    expect((await f.update(uid, { contact_groups: [] })).status).toBe(200);
    expect(await db.groupContacts.count({ where: { contactId: contact.id } })).toBe(0);
  });
  it('rejects invalid/foreign/archived groups and typed values before writing', async () => {
    const f = await fixture(),
      foreign = await fixture();
    for (const body of [
      { contact_groups: [foreign.groups[0].id] },
      { custom_input_fields: { [foreign.field.uid]: '1' } },
      { custom_input_fields: { [f.field.uid]: 'wrong' } },
    ])
      expect((await f.create(body)).status).toBe(400);
    await db.contactGroups.update({ where: { id: f.groups[0].id }, data: { status: 5 } });
    expect((await f.create({ contact_groups: [f.groups[0].id] })).status).toBe(400);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(0);
    const c = await f.create();
    expect(
      (
        await f.update(c.body.contactIdOrUid, {
          first_name: 'must roll back',
          custom_input_fields: { [f.field.uid]: 'wrong' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { uid: c.body.contactIdOrUid } })).firstName,
    ).toBe('Original');
  });
  it('serializes duplicate creation and rejects conflicting update phones without changing contact', async () => {
    const f = await fixture(),
      results = await Promise.all([f.create(), f.create()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const second = await f.create({ phone_number: '919876543211' });
    expect(
      (
        await f.update(second.body.contactIdOrUid, {
          phone_number: '919876543210',
          first_name: 'conflict',
        })
      ).body.error.code,
    ).toBe('CONTACT_EXISTS');
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { uid: second.body.contactIdOrUid } }))
        .firstName,
    ).toBe('Original');
  });
  it('limits assigned actors and ignores hidden phone updates while requiring group and AI permissions', async () => {
    const f = await fixture([
      'vendor.contacts.create',
      'vendor.contacts.edit',
      'vendor.chats.view_assigned',
    ]);
    const created = await f.create(),
      uid = created.body.contactIdOrUid;
    expect(created.status).toBe(201);
    expect(
      (await f.update(uid, { phone_number: '919876543211', first_name: 'Visible edit' })).status,
    ).toBe(200);
    expect((await db.contacts.findUniqueOrThrow({ where: { uid } })).waId).toBe('919876543210');
    expect((await f.update(uid, { contact_groups: [] })).status).toBe(403);
    expect((await f.update(uid, { enable_ai_bot: false })).status).toBe(403);
    await db.contacts.update({ where: { uid }, data: { assignedUserId: null } });
    expect((await f.update(uid, { first_name: 'hidden' })).status).toBe(404);
  });
  it('requires provider-aware AI resume and entitlement without changing paused state', async () => {
    const f = await fixture(),
      created = await f.create();
    const result = await f.update(created.body.contactIdOrUid, {
      first_name: 'blocked',
      enable_ai_bot: true,
    });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('AI_RESUME_REQUIRED');
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { uid: created.body.contactIdOrUid } }))
        .firstName,
    ).toBe('Original');
    expect(
      (await f.create({ phone_number: '919876543211', enable_ai_bot: true })).body.error.code,
    ).toBe('AI_ENTITLEMENT_REQUIRED');
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('rejects connected-number/phone-scope mismatches and imported foreign membership replacement', async () => {
    const f = await fixture(),
      foreign = await fixture();
    expect((await f.create({ wab_phone_number_id: '123456789' })).body.error.code).toBe(
      'INVALID_PHONE_SCOPE',
    );
    await db.contactGroups.update({
      where: { id: f.groups[0].id },
      data: { wabPhoneNumberId: '123456789' },
    });
    expect((await f.create({ contact_groups: [f.groups[0].id] })).body.error.code).toBe(
      'PHONE_SCOPE_MISMATCH',
    );
    const c = await f.create(),
      contact = await db.contacts.findUniqueOrThrow({ where: { uid: c.body.contactIdOrUid } });
    await db.groupContacts.create({
      data: { contactId: contact.id, groupId: foreign.groups[0].id },
    });
    expect(
      (await f.update(contact.uid, { contact_groups: [], first_name: 'blocked' })).body.error.code,
    ).toBe('GROUP_SCOPE_PENDING');
    expect(await db.groupContacts.count({ where: { contactId: contact.id } })).toBe(1);
  });
  it('rolls back create/update, memberships and values on audit failure', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
    function failAudit() {
      vi.spyOn(db, '$transaction').mockImplementationOnce(((callback: any, options: any) =>
        transaction(
          async (tx) =>
            callback(
              new Proxy(tx, {
                get(target, key, receiver) {
                  return key === 'auditEvents'
                    ? {
                        ...tx.auditEvents,
                        create: async () => {
                          throw new Error('audit unavailable');
                        },
                      }
                    : Reflect.get(target, key, receiver);
                },
              }),
            ),
          options,
        )) as any);
    }
    failAudit();
    expect((await f.create({ contact_groups: [f.groups[0].id] })).status).toBe(500);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(0);
    const created = await f.create({ contact_groups: [f.groups[0].id] });
    failAudit();
    expect(
      (
        await f.update(created.body.contactIdOrUid, {
          first_name: 'rollback',
          contact_groups: [f.groups[1].id],
          custom_input_fields: { [f.field.uid]: '5' },
        })
      ).status,
    ).toBe(500);
    const contact = await db.contacts.findUniqueOrThrow({
      where: { uid: created.body.contactIdOrUid },
    });
    expect(contact.firstName).toBe('Original');
    expect(
      await db.groupContacts.count({ where: { contactId: contact.id, groupId: f.groups[0].id } }),
    ).toBe(1);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: contact.id } })).toBe(0);
  });
  it('rejects foreign identity, malformed/duplicate/unbounded fields and server-owned data', async () => {
    const f = await fixture(),
      foreign = await fixture(),
      c = await foreign.create();
    expect((await f.update(c.body.contactIdOrUid, { first_name: 'foreign' })).status).toBe(404);
    for (const body of [
      { phone_number: '+919876543210' },
      { phone_number: '0123456789' },
      { vendorId: f.vendorId },
      { contact_groups: [f.groups[0].id, f.groups[0].id] },
      { custom_input_fields: { invalid: '1' } },
      { first_name: 'x'.repeat(101) },
    ])
      expect((await f.create(body)).status).toBe(400);
    expect(
      (await request(app).post(`${base}/add-process`).send({ phone_number: '919876543210' }))
        .status,
    ).toBe(401);
    expect((await f.update(randomUUID(), {})).status).toBe(400);
  });
});
