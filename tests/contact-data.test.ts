import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `5544${f.vendorId}`;
  await db.integrationCredentials.create({
    data: {
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId: phone,
      secret: encrypt('test-csv'),
    },
  });
  const contact = await db.contacts.create({
    data: {
      vendorId: f.vendorId,
      firstName: 'Existing',
      waId: '919876543210',
      wabPhoneNumberId: phone,
      assignedUserId: f.userId,
    },
  });
  const country = await db.countries.create({
    data: {
      name: `Test country ${randomUUID()}`,
      isoCode: `Z${f.vendorId}`,
      iso3Code: `T${f.vendorId}`,
    },
  });
  return {
    ...f,
    phone,
    contact,
    country,
    auth: `Bearer ${f.token}`,
    path: `/api/v1/vendors/${f.vendorId}/contacts`,
  };
}
async function field(f: Awaited<ReturnType<typeof fixture>>, type = 'text', name = 'answer') {
  return db.contactCustomFields.create({
    data: { vendorId: f.vendorId, inputName: name, inputType: type },
  });
}
const put = (f: Awaited<ReturnType<typeof fixture>>, values: any[]) =>
  request(app)
    .put(`${f.path}/${f.contact.id}/custom-values`)
    .set('Authorization', f.auth)
    .send({ values });
const importCsv = (f: Awaited<ReturnType<typeof fixture>>, csv: string, extra = {}) =>
  request(app)
    .post(`${f.path}/import`)
    .set('Authorization', f.auth)
    .send({ csv, phoneNumberId: f.phone, ...extra });
const values = (f: Awaited<ReturnType<typeof fixture>>) =>
  db.contactCustomFieldValues.findMany({ where: { contactId: f.contact.id } });

describe('typed native contact values', () => {
  it.each([
    ['text', ' text ', '\u0000bad'],
    ['number', ' -1.25e3 ', 'NaN'],
    ['email', ' a@example.com ', 'not-email'],
    ['url', ' https://example.com/x ', 'javascript:alert(1)'],
    ['date', '2024-02-29', '2025-02-29'],
    ['time', '23:59:59', '24:30'],
    ['datetime-local', '2024-02-29T01:23', '2025-02-29T01:23'],
  ])(
    'validates %s, preserves accepted values on rejection and supports clearing',
    async (type, good, bad) => {
      const f = await fixture(),
        definition = await field(f, type);
      expect((await put(f, [{ fieldId: definition.id, value: good }])).status).toBe(204);
      expect((await put(f, [{ fieldId: definition.id, value: bad }])).status).toBe(400);
      expect((await values(f))[0].fieldValue).toBe(good.trim());
      expect((await put(f, [{ fieldId: definition.id, value: null }])).status).toBe(204);
      expect((await values(f))[0].fieldValue).toBeNull();
      expect((await put(f, [{ fieldId: definition.id, value: '' }])).status).toBe(204);
      expect((await values(f))[0].fieldValue).toBe('');
    },
  );
  it('validates the entire patch before any writes and audits identifiers without values', async () => {
    const f = await fixture(),
      text = await field(f),
      number = await field(f, 'number', 'amount');
    await put(f, [{ fieldId: text.id, value: 'original' }]);
    expect(
      (
        await put(f, [
          { fieldId: text.id, value: 'new' },
          { fieldId: number.id, value: 'invalid' },
        ])
      ).status,
    ).toBe(400);
    expect(await values(f)).toHaveLength(1);
    expect((await values(f))[0].fieldValue).toBe('original');
    const audits = await db.auditEvents.findMany({
      where: { vendorId: f.vendorId, resource: 'contact-custom-value' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ fieldIds: [text.id] });
    expect(JSON.stringify(audits)).not.toContain('original');
  });
  it('rejects foreign definitions, hidden contacts, duplicate IDs and unsupported field types', async () => {
    const f = await fixture(),
      other = await fixture(),
      foreign = await field(other),
      own = await field(f);
    expect((await put(f, [{ fieldId: foreign.id, value: 'secret' }])).status).toBe(400);
    expect(
      (
        await put(f, [
          { fieldId: own.id, value: 'a' },
          { fieldId: own.id, value: 'b' },
        ])
      ).status,
    ).toBe(400);
    const pending = await field(f, 'select', 'unsupported');
    expect((await put(f, [{ fieldId: pending.id, value: 'x' }])).status).toBe(409);
    const agent = await fixture(['vendor.contacts.edit']);
    await db.contacts.update({ where: { id: agent.contact.id }, data: { assignedUserId: null } });
    expect((await put(agent, [{ fieldId: (await field(agent)).id, value: 'x' }])).status).toBe(404);
    expect(await values(f)).toHaveLength(0);
  });
  it('serializes concurrent updates without creating duplicate value records', async () => {
    const f = await fixture(),
      own = await field(f);
    const replies = await Promise.all(
      ['a', 'b'].map((value) => put(f, [{ fieldId: own.id, value }])),
    );
    expect(replies.some((r) => r.status === 204)).toBe(true);
    expect(replies.every((r) => [204, 409].includes(r.status))).toBe(true);
    expect(await values(f)).toHaveLength(1);
  });
  it('accepts only real country references on ordinary contact create/edit and permits clearing', async () => {
    const f = await fixture();
    const created = await request(app)
      .post(f.path)
      .set('Authorization', f.auth)
      .send({ phone: '+919876543211', countryId: f.country.id });
    expect(created.status).toBe(201);
    expect(created.body.countryId).toBe(f.country.id);
    expect(
      (
        await request(app)
          .patch(`${f.path}/${created.body.id}`)
          .set('Authorization', f.auth)
          .send({ countryId: 2147483647 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`${f.path}/${created.body.id}`)
          .set('Authorization', f.auth)
          .send({ countryId: null })
      ).status,
    ).toBe(200);
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: created.body.id } })).countryId,
    ).toBeNull();
  });
});

describe('extended native contact CSV', () => {
  it('imports source headers, country codes, ordered custom fields and deduplicated group links atomically', async () => {
    const f = await fixture(),
      company = await field(f, 'text', 'company'),
      amount = await field(f, 'number', 'amount');
    const a = await db.contactGroups.create({
      data: { vendorId: f.vendorId, title: 'Sales', wabPhoneNumberId: f.phone },
    });
    const b = await db.contactGroups.create({ data: { vendorId: f.vendorId, title: 'Support' } });
    const csv = `Full Name,Mobile,Language,Country,Groups,company,amount\nNew,919876543212,en,${f.country.isoCode?.toLowerCase()},"Sales,Support,Sales",Acme,-5`;
    const response = await importCsv(f, csv, { groupId: a.id });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ created: 1, skipped: 0 });
    const contact = await db.contacts.findFirstOrThrow({
      where: { vendorId: f.vendorId, waId: '919876543212' },
    });
    expect(contact).toMatchObject({
      firstName: 'New',
      countryId: f.country.id,
      languageCode: 'en',
      wabPhoneNumberId: f.phone,
    });
    expect(
      await db.groupContacts.findMany({
        where: { contactId: contact.id },
        orderBy: { groupId: 'asc' },
      }),
    ).toMatchObject([{ groupId: a.id }, { groupId: b.id }]);
    expect(
      await db.contactCustomFieldValues.findMany({
        where: { contactId: contact.id },
        orderBy: { contactCustomFieldsId: 'asc' },
      }),
    ).toMatchObject([
      { contactCustomFieldsId: company.id, fieldValue: 'Acme' },
      { contactCustomFieldsId: amount.id, fieldValue: '-5' },
    ]);
    expect((await importCsv(f, csv)).body).toEqual({ created: 0, skipped: 1 });
  });
  it('rolls back the entire import when a later row has invalid typed data', async () => {
    const f = await fixture();
    await field(f, 'email', 'work_email');
    const response = await importCsv(
      f,
      'phone,work_email\n919876543212,a@example.com\n919876543213,invalid',
    );
    expect(response.status).toBe(400);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'import' } })).toBe(
      0,
    );
  });
  it.each(['foreign', 'other-phone', 'archived', 'duplicate'])(
    'rejects %s group references without contact creation',
    async (scenario) => {
      const f = await fixture(),
        other = await fixture();
      await db.contactGroups.create({
        data: {
          vendorId: scenario === 'foreign' ? other.vendorId : f.vendorId,
          title: 'Group',
          wabPhoneNumberId: scenario === 'other-phone' ? other.phone : f.phone,
          status: scenario === 'archived' ? 5 : 1,
        },
      });
      if (scenario === 'duplicate')
        await db.contactGroups.create({
          data: { vendorId: f.vendorId, title: 'Group', wabPhoneNumberId: f.phone },
        });
      expect((await importCsv(f, 'phone,groups\n919876543212,Group')).status).toBe(400);
      expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(1);
    },
  );
  it('requires group administration for group columns and skips existing contacts without modifying private data', async () => {
    const f = await fixture(['vendor.contacts.create']);
    await field(f, 'text', 'company');
    expect((await importCsv(f, 'phone,groups\n919876543212,Group')).status).toBe(403);
    expect(
      (await importCsv(f, 'phone,company,countryId\n919876543210,Changed,' + f.country.id)).body,
    ).toEqual({ created: 0, skipped: 1 });
    expect(
      (await db.contacts.findUniqueOrThrow({ where: { id: f.contact.id } })).countryId,
    ).toBeNull();
    expect(await values(f)).toHaveLength(0);
    expect((await importCsv(f, 'phone,company\n919876543212,New')).status).toBe(201);
    expect(
      (
        await db.contacts.findFirstOrThrow({
          where: { vendorId: f.vendorId, waId: '919876543212' },
        })
      ).assignedUserId,
    ).toBe(f.userId);
  });
  it('rejects country ambiguity, foreign custom names, duplicate headers, ownership keys and malformed rows', async () => {
    const f = await fixture(),
      other = await fixture();
    await field(other, 'text', 'foreign');
    await field(f, 'text', 'duplicate');
    await field(f, 'text', 'duplicate');
    await db.countries.create({ data: { name: f.country.name } });
    for (const csv of [
      `phone,country\n919876543212,${f.country.name}`,
      'phone,countryId\n919876543212,2147483647',
      'phone,foreign\n919876543212,x',
      'phone,duplicate\n919876543212,x',
      'phone,phone number\n919876543212,919876543213',
      'phone,vendorId\n919876543212,5',
      'phone,__proto__\n919876543212,x',
      'phone,firstName\n919876543212',
    ])
      expect((await importCsv(f, csv)).status).toBe(400);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });
  it('exports values by field ID with formula guards and reimports JSON group names and negative numbers', async () => {
    const f = await fixture(),
      text = await field(f, 'text', 'company'),
      number = await field(f, 'number', 'amount'),
      alias = await field(f, 'text', 'phone');
    await put(f, [
      { fieldId: number.id, value: '-5' },
      { fieldId: alias.id, value: 'Custom phone' },
      { fieldId: text.id, value: '=HYPERLINK("https://example.com")' },
    ]);
    const group = await db.contactGroups.create({
      data: { vendorId: f.vendorId, title: 'Sales, East', wabPhoneNumberId: f.phone },
    });
    await db.groupContacts.create({ data: { groupId: group.id, contactId: f.contact.id } });
    await db.contacts.update({ where: { id: f.contact.id }, data: { countryId: f.country.id } });
    const exported = await request(app)
      .get(`${f.path}/export?extended=true`)
      .set('Authorization', f.auth);
    expect(exported.status).toBe(200);
    const records = parse(exported.text, { columns: true }) as Record<string, string>[];
    expect(records[0]).toMatchObject({
      countryId: String(f.country.id),
      groups: '["Sales, East"]',
      'custom:company': '\'=HYPERLINK("https://example.com")',
      'custom:amount': "'-5",
      'custom:phone': 'Custom phone',
    });
    const csv = exported.text.replace('919876543210', '919876543212');
    expect((await importCsv(f, csv)).status).toBe(201);
    const contact = await db.contacts.findFirstOrThrow({
      where: { vendorId: f.vendorId, waId: '919876543212' },
    });
    expect(
      await db.contactCustomFieldValues.findFirst({
        where: { contactId: contact.id, contactCustomFieldsId: number.id },
      }),
    ).toMatchObject({ fieldValue: '-5' });
    expect(await db.groupContacts.findFirst({ where: { contactId: contact.id } })).toMatchObject({
      groupId: group.id,
    });
  });
  it('keeps extended exports assigned-only and excludes phone, email and custom values without phone permission', async () => {
    const f = await fixture(['vendor.contacts.view']),
      own = await field(f, 'email');
    await db.contactCustomFieldValues.create({
      data: {
        contactId: f.contact.id,
        contactCustomFieldsId: own.id,
        fieldValue: 'private@example.com',
      },
    });
    await db.contacts.create({
      data: { vendorId: f.vendorId, firstName: 'Hidden', waId: '919876543213' },
    });
    const exported = await request(app)
      .get(`${f.path}/export?extended=true`)
      .set('Authorization', f.auth);
    expect(exported.status).toBe(200);
    const records = parse(exported.text, { columns: true }) as Record<string, string>[];
    expect(records).toHaveLength(1);
    expect(records[0].phone).toBe('***3210');
    expect(records[0]['custom:answer']).toBe('');
    expect(exported.text).not.toContain('private@example.com');
    expect(exported.text).not.toContain('Hidden');
  });
  it('rejects ambiguous export names before sending a CSV header', async () => {
    const f = await fixture();
    await field(f);
    await field(f);
    const response = await request(app)
      .get(`${f.path}/export?extended=true`)
      .set('Authorization', f.auth);
    expect(response.status).toBe(409);
    expect(response.headers['content-type']).toContain('application/json');
    expect((await request(app).get(`${f.path}/export`).set('Authorization', f.auth)).status).toBe(
      200,
    );
  });
});
