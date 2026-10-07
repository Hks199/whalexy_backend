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
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      assignedUserId: f.userId,
      waId: '919876543210',
      firstName: 'Reader',
      email: 'private@example.com',
      data: { private_referral: 'do not expose', contact_notes: 'internal' },
    },
  });
  const group = await db.contactGroups.create({ data: { vendorId: f.vendorId, title: 'Owned' } });
  await db.groupContacts.create({ data: { groupId: group.id, contactId: contact.id } });
  const field = await db.contactCustomFields.create({
    data: { vendorId: f.vendorId, inputName: randomUUID(), inputType: 'text', name: 'Company' },
  });
  await db.contactCustomFieldValues.create({
    data: { contactId: contact.id, contactCustomFieldsId: field.id, fieldValue: 'Company value' },
  });
  const read = (id: string | number = contact.uid) =>
    request(app).get(`${base}/${id}/get-update-data`).set('Authorization', `Bearer ${f.token}`);
  const remove = (id: string | number = contact.uid, body: Record<string, unknown> = {}) =>
    request(app)
      .post(`${base}/${id}/delete-process`)
      .set('Authorization', `Bearer ${f.token}`)
      .send(body);
  return { ...f, contact, group, field, read, remove };
}
describe('original contact record read/delete adapters', () => {
  it('reads numeric and UUID edit data with original group/custom-value fields and no raw metadata', async () => {
    const f = await fixture();
    for (const id of [f.contact.id, f.contact.uid]) {
      const result = await f.read(id);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        _id: f.contact.id,
        _uid: f.contact.uid,
        first_name: 'Reader',
        wa_id: f.contact.waId,
        email: 'private@example.com',
        existingGroupIds: JSON.stringify([f.group.id]),
        groups: [{ _id: f.group.id, _uid: f.group.uid, title: 'Owned' }],
        custom_field_values: [
          { contact_custom_fields__id: f.field.id, field_value: 'Company value' },
        ],
      });
      for (const key of ['data', '__data', 'vendorId', 'vendors__id', 'private_referral'])
        expect(result.body[key]).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('do not expose');
    }
  });
  it('masks phone/email and limits edit data and deletion to assigned contact visibility', async () => {
    const f = await fixture([
      'vendor.contacts.view',
      'vendor.contacts.delete',
      'vendor.chats.view_assigned',
    ]);
    expect((await f.read()).body).toMatchObject({ wa_id: '***3210', email: null });
    await db.contacts.update({ where: { id: f.contact.id }, data: { assignedUserId: null } });
    expect((await f.read()).status).toBe(404);
    expect((await f.remove()).status).toBe(404);
    expect(await db.groupContacts.count({ where: { contactId: f.contact.id } })).toBe(1);
  });
  it('does not expose imported foreign group/custom-value links', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.groupContacts.create({ data: { contactId: f.contact.id, groupId: other.group.id } });
    await db.contactCustomFieldValues.create({
      data: {
        contactId: f.contact.id,
        contactCustomFieldsId: other.field.id,
        fieldValue: 'foreign value',
      },
    });
    const result = await f.read();
    expect(result.status).toBe(200);
    expect(result.body.groups).toHaveLength(1);
    expect(result.body.custom_field_values).toHaveLength(1);
    expect(JSON.stringify(result.body)).not.toContain('foreign value');
  });
  it('deletes numeric/UUID contacts and owned restrictive links while preserving unrelated contacts', async () => {
    for (const useUuid of [false, true]) {
      const f = await fixture(),
        unrelated = await db.contacts.create({ data: { vendorId: f.vendorId } });
      const result = await f.remove(useUuid ? f.contact.uid : f.contact.id);
      expect(result.status).toBe(200);
      expect(result.body.status).toBe('success');
      expect(await db.contacts.findUnique({ where: { id: f.contact.id } })).toBeNull();
      expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(
        0,
      );
      expect(await db.groupContacts.count({ where: { contactId: f.contact.id } })).toBe(0);
      expect(await db.contacts.findUnique({ where: { id: unrelated.id } })).not.toBeNull();
      expect(
        await db.auditEvents.count({
          where: { vendorId: f.vendorId, action: 'delete', resource: 'contact' },
        }),
      ).toBe(1);
      expect((await f.remove()).status).toBe(404);
    }
  });
  it('blocks campaign test contacts and retained handoff references without partial cleanup', async () => {
    const f = await fixture();
    const setting = await db.vendorSettings.create({
      data: { vendorId: f.vendorId, name: 'test_recipient_contact', value: f.contact.uid },
    });
    expect((await f.remove()).body.error.code).toBe('CAMPAIGN_TEST_CONTACT');
    await db.vendorSettings.delete({ where: { id: setting.id } });
    const handoff = await db.aiConversationHandoffs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contact.id,
        status: 'resolved',
        reason: 'retained history',
        severity: 'normal',
        requestedAt: new Date(),
      },
    });
    const blocked = await f.remove();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CONTACT_REFERENCES_PENDING');
    expect(await db.groupContacts.count({ where: { contactId: f.contact.id } })).toBe(1);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(1);
    expect(
      await db.aiConversationHandoffs.findUnique({ where: { id: handoff.id } }),
    ).not.toBeNull();
    expect(await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'delete' } })).toBe(
      0,
    );
  });
  it('rolls back deletion and link cleanup when auditing fails', async () => {
    const f = await fixture(),
      transaction = db.$transaction.bind(db);
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
    expect((await f.remove()).status).toBe(500);
    expect(await db.contacts.findUnique({ where: { id: f.contact.id } })).not.toBeNull();
    expect(await db.groupContacts.count({ where: { contactId: f.contact.id } })).toBe(1);
    expect(await db.contactCustomFieldValues.count({ where: { contactId: f.contact.id } })).toBe(1);
  });
  it('rejects foreign/missing/invalid identifiers, unauthorized access and ownership fields', async () => {
    const f = await fixture(),
      other = await fixture(),
      noPermission = await fixture([]);
    expect((await f.read(other.contact.uid)).status).toBe(404);
    expect((await f.remove(other.contact.id)).status).toBe(404);
    expect((await f.read(randomUUID())).status).toBe(404);
    expect((await f.read('invalid')).status).toBe(400);
    expect((await f.remove(-1)).status).toBe(400);
    expect((await f.remove(f.contact.uid, { vendorId: f.vendorId })).status).toBe(400);
    expect((await noPermission.read()).status).toBe(403);
    expect((await noPermission.remove()).status).toBe(403);
    expect((await request(app).get(`${base}/${f.contact.uid}/get-update-data`)).status).toBe(401);
  });
  it('rejects oversized imported profiles instead of truncating the edit selection', async () => {
    const f = await fixture();
    await db.contactGroups.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        vendorId: f.vendorId,
        title: `Imported ${i}`,
      })),
    });
    const groups = await db.contactGroups.findMany({
      where: { vendorId: f.vendorId },
      select: { id: true },
    });
    await db.groupContacts.createMany({
      data: groups.map((g) => ({ contactId: f.contact.id, groupId: g.id })),
      skipDuplicates: true,
    });
    expect((await f.read()).body.error.code).toBe('CONTACT_PROFILE_TOO_LARGE');
  });
});
