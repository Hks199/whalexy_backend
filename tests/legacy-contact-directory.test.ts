import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/contacts/list-data';
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `12345${f.vendorId}`,
    otherPhone = `98765${f.vendorId}`;
  const contacts = await Promise.all(
    [
      { firstName: 'Alpha', platform: null, waId: '919876543210', wabPhoneNumberId: phone },
      { firstName: 'Beta', platform: '', waId: '919876543211', wabPhoneNumberId: otherPhone },
      { firstName: 'Gamma', platform: 'whatsapp', waId: '919876543212', wabPhoneNumberId: null },
      { firstName: 'Insta', platform: 'instagram', instagramId: 'private-social-id' },
      { firstName: 'Facebook', platform: 'facebook', facebookId: 'private-facebook-id' },
      { firstName: 'Messenger', platform: 'messenger' },
    ].map((data) =>
      db.contacts.create({
        data: {
          vendorId: f.vendorId,
          assignedUserId: f.userId,
          email: 'secret@example.com',
          data: { referral_secret: 'private-data' },
          createdAt: new Date('2026-01-02T00:00:00Z'),
          ...data,
        },
      }),
    ),
  );
  const group = await db.contactGroups.create({
    data: { vendorId: f.vendorId, title: 'Mixed sender group', wabPhoneNumberId: phone },
  });
  await db.groupContacts.createMany({
    data: contacts.map((c) => ({ contactId: c.id, groupId: group.id })),
  });
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: 'unused-local-test-value',
    },
  });
  const read = (query: Record<string, unknown> = {}, uid?: string) =>
    request(app)
      .get(`${base}${uid ? `/${uid}` : ''}`)
      .set('Authorization', `Bearer ${f.token}`)
      .query(query);
  return { ...f, phone, contacts, group, read };
}
describe('original DataTables contact directory', () => {
  it('projects source fields and WhatsApp null/empty platforms with stable bounded pagination', async () => {
    const f = await fixture(),
      expected = f.contacts.slice(0, 3).sort((a, b) => a.id - b.id)[1],
      result = await f.read({ draw: 12, start: 1, length: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ draw: 12, recordsTotal: 3, recordsFiltered: 3 });
    expect(result.body.data).toHaveLength(1);
    expect(result.body.data[0]).toMatchObject({
      _id: expected.id,
      _uid: expected.uid,
      first_name: expected.firstName,
      phone_number: expected.waId,
      email: 'secret@example.com',
      created_at: '02/01/26',
      whatsapp_opt_out: 'Opted In',
      disable_ai_bot: 'Enabled',
    });
    expect(JSON.stringify(result.body)).not.toContain('private-data');
    for (const key of ['data', '__data', 'vendorId', 'vendors__id'])
      expect(result.body.data[0][key]).toBeUndefined();
  });
  it('keeps group members across sender numbers while restricting the general phone directory', async () => {
    const f = await fixture();
    expect((await f.read({ from_phone_number_id: f.phone })).body.recordsTotal).toBe(1);
    const grouped = await f.read({ from_phone_number_id: f.phone }, f.group.uid);
    expect(grouped.status).toBe(200);
    expect(grouped.body.recordsTotal).toBe(3);
    const empty = await db.contactGroups.create({ data: { vendorId: f.vendorId, title: 'Empty' } });
    expect((await f.read({}, empty.uid)).body.data).toEqual([]);
    expect((await f.read({ from_phone_number_id: '555555555' })).body.error.code).toBe(
      'INVALID_PHONE_SCOPE',
    );
  });
  it('filters stored social contacts with source Messenger aliases without calling providers', async () => {
    const f = await fixture();
    const instagram = await f.read({ platform: 'instagram' });
    expect(instagram.body.recordsTotal).toBe(1);
    expect(instagram.body.data[0].instagram_id).toBe('private-social-id');
    const facebook = await f.read({ platform: 'facebook' }, f.group.uid);
    expect(facebook.body.recordsTotal).toBe(2);
    expect(facebook.body.data.map((c: any) => c.first_name).sort()).toEqual([
      'Facebook',
      'Messenger',
    ]);
  });
  it('searches visible fields and applies source column ordering with separate totals', async () => {
    const f = await fixture();
    const result = await f.read({
      'search[value]': 'ALPHA',
      'order[0][column]': 2,
      'order[0][dir]': 'desc',
    });
    expect(result.body).toMatchObject({ recordsTotal: 3, recordsFiltered: 1 });
    expect(result.body.data[0].first_name).toBe('Alpha');
    const names = await f.read({ 'order[0][column]': 2, 'order[0][dir]': 'desc' });
    expect(names.body.data.map((c: any) => c.first_name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect((await f.read({ 'search[value]': '543211' })).body.recordsFiltered).toBe(1);
    expect((await f.read({ start: 100 })).body.data).toEqual([]);
    expect((await f.read({ 'order[0][column]': 9 })).status).toBe(200);
  });
  it('masks sensitive fields and prevents hidden-field search/sort inference within assigned scope', async () => {
    const f = await fixture(['vendor.contacts.view', 'vendor.chats.view_assigned']);
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { assignedUserId: null } });
    const result = await f.read();
    expect(result.body.recordsTotal).toBe(2);
    expect(result.body.data.find((c: any) => c._uid === f.contacts[0].uid)).toMatchObject({
      phone_number: '***3210',
      email: null,
    });
    expect((await f.read({ 'search[value]': 'secret@example.com' })).body.recordsFiltered).toBe(0);
    expect((await f.read({ 'search[value]': '919876543210' })).body.recordsFiltered).toBe(0);
    expect((await f.read({ 'order[0][column]': 11 })).status).toBe(403);
    expect((await f.read({ platform: 'instagram' })).body.data[0].instagram_id).toBeNull();
    expect((await f.read({}, f.group.uid)).body.recordsTotal).toBe(2);
  });
  it('rejects foreign/missing/invalid groups and never exposes imported foreign contacts', async () => {
    const f = await fixture(),
      other = await fixture();
    await db.groupContacts.create({
      data: { groupId: f.group.id, contactId: other.contacts[0].id },
    });
    expect((await f.read({}, f.group.uid)).body.recordsTotal).toBe(3);
    expect((await f.read({}, other.group.uid)).status).toBe(404);
    expect((await f.read({}, randomUUID())).status).toBe(404);
    expect((await f.read({}, 'invalid')).status).toBe(400);
    expect((await request(app).get(base)).status).toBe(401);
    const noPermission = await fixture([]);
    expect((await noPermission.read()).status).toBe(403);
  });
  it('rejects unbounded, unsafe and unsupported DataTables inputs', async () => {
    const f = await fixture();
    for (const query of [
      { length: -1 },
      { length: 101 },
      { start: -1 },
      { draw: -1 },
      { 'search[regex]': true },
      { 'order[0][column]': 4 },
      { 'order[1][column]': 2 },
      { 'columns[2][search][value]': 'hidden filter' },
      { platform: 'other' },
      { vendorId: f.vendorId },
    ])
      expect((await f.read(query)).status).toBe(400);
    expect(
      (
        await f.read({
          'columns[2][data]': 'first_name',
          'columns[2][search][value]': '',
          'columns[2][search][regex]': false,
        })
      ).status,
    ).toBe(200);
  });
});
