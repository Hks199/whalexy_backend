import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>, foreign: typeof owner, agent: typeof owner;
let base: string, foreignBase: string;
const auth = () => `Bearer ${owner.token}`;
const phone = () =>
  '91' +
  String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 10)) % 10000000000n).padStart(
    10,
    '0',
  );
beforeAll(async () => {
  owner = await businessFixture();
  foreign = await businessFixture();
  agent = await businessFixture(['vendor.contacts.create', 'vendor.contacts.edit']);
  await db.nativeMemberships.create({
    data: {
      vendorId: owner.vendorId,
      userId: agent.userId,
      role: 'agent',
      permissions: ['vendor.contacts.create', 'vendor.contacts.edit'],
    },
  });
  base = `/api/${(await db.vendors.findUniqueOrThrow({ where: { id: owner.vendorId } })).uid}/contact`;
  foreignBase = `/api/${(await db.vendors.findUniqueOrThrow({ where: { id: foreign.vendorId } })).uid}/contact`;
});
afterAll(async () => db.$disconnect());

describe('original contact API adapters', () => {
  it('creates and updates original fields, country, groups and typed custom values', async () => {
    const country = await db.countries.create({ data: { name: `Country ${randomUUID()}` } });
    const field = await db.contactCustomFields.create({
      data: { vendorId: owner.vendorId, inputName: 'score', inputType: 'number' },
    });
    const number = phone();
    const created = await request(app)
      .post(`${base}/create`)
      .set('Authorization', auth())
      .send({
        phone_number: number,
        first_name: 'First',
        country: country.name.toLowerCase(),
        groups: 'New leads, VIP,VIP',
        custom_input_fields: { [field.uid]: ' 23.4 ' },
        whatsapp_opt_out: true,
        enable_ai_bot: false,
      });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      result: 'success',
      data: { first_name: 'First', phone_number: number, country: country.name },
    });
    const contact = await db.contacts.findUniqueOrThrow({
      where: { uid: created.body.data.contact_uid },
    });
    expect(await db.groupContacts.count({ where: { contactId: contact.id } })).toBe(2);
    expect(
      (await db.contactCustomFieldValues.findFirst({ where: { contactId: contact.id } }))
        ?.fieldValue,
    ).toBe('23.4');
    const updated = await request(app)
      .post(`${base}/update/${number}`)
      .set('Authorization', auth())
      .send({ last_name: 'Last' });
    expect(updated.status).toBe(200);
    const stored = await db.contacts.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stored).toMatchObject({ lastName: 'Last', whatsappOptOut: 1, disableAiBot: 1 });
    expect(await db.groupContacts.count({ where: { contactId: contact.id } })).toBe(2);
    expect(
      (
        await request(app)
          .post(`${base}/update/${number}`)
          .set('Authorization', auth())
          .send({ groups: '', enable_ai_bot: true })
      ).status,
    ).toBe(200);
    expect(await db.groupContacts.count({ where: { contactId: contact.id } })).toBe(0);
  });
  it('rolls back all changes when a foreign or invalid custom field is supplied', async () => {
    const foreignField = await db.contactCustomFields.create({
      data: { vendorId: foreign.vendorId, inputName: 'foreign', inputType: 'text' },
    });
    const number = phone();
    const response = await request(app)
      .post(`${base}/create`)
      .set('Authorization', auth())
      .send({
        phone_number: number,
        groups: 'Rollback group',
        custom_input_fields: { [foreignField.uid]: 'bad' },
      });
    expect(response.status).toBe(400);
    expect(await db.contacts.count({ where: { vendorId: owner.vendorId, waId: number } })).toBe(0);
    expect(
      await db.contactGroups.count({
        where: { vendorId: owner.vendorId, title: 'Rollback group' },
      }),
    ).toBe(0);
    const field = await db.contactCustomFields.create({
      data: { vendorId: owner.vendorId, inputName: 'numeric', inputType: 'number' },
    });
    expect(
      (
        await request(app)
          .post(`${base}/create`)
          .set('Authorization', auth())
          .send({ phone_number: number, custom_input_fields: { [field.uid]: 'not a number' } })
      ).status,
    ).toBe(400);
    expect(await db.contacts.count({ where: { vendorId: owner.vendorId, waId: number } })).toBe(0);
  });
  it('enforces permissions, membership, assignment and phone privacy', async () => {
    const number = phone();
    await db.contacts.create({
      data: { vendorId: owner.vendorId, waId: number, platform: 'whatsapp' },
    });
    expect(
      (
        await request(app)
          .post(`${foreignBase}/create`)
          .set('Authorization', auth())
          .send({ phone_number: phone() })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`${base}/update/${number}`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ first_name: 'Hidden' })
      ).status,
    ).toBe(404);
    const assigned = await request(app)
      .post(`${base}/create`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ phone_number: phone() });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.phone_number).toMatch(/^\*\*\*\d{4}$/);
    const contact = await db.contacts.findUniqueOrThrow({
      where: { uid: assigned.body.data.contact_uid },
    });
    expect(contact.assignedUserId).toBe(agent.userId);
    expect(
      (
        await request(app)
          .post(`${base}/create`)
          .set('Authorization', `Bearer ${agent.token}`)
          .send({ phone_number: phone(), groups: 'Denied' })
      ).status,
    ).toBe(403);
  });
  it('requires an owned business number to resolve duplicate recipients', async () => {
    const number = phone(),
      businessNumber = '8811' + owner.vendorId + '1',
      secondNumber = '8811' + owner.vendorId + '2';
    for (const externalId of [businessNumber, secondNumber]) {
      await db.integrationCredentials.create({
        data: {
          vendorId: owner.vendorId,
          provider: 'whatsapp',
          externalId,
          secret: 'unused',
        },
      });
      await db.contacts.create({
        data: {
          vendorId: owner.vendorId,
          waId: number,
          platform: 'whatsapp',
          wabPhoneNumberId: externalId,
        },
      });
    }
    expect(
      (
        await request(app)
          .post(`${base}/update/${number}`)
          .set('Authorization', auth())
          .send({ first_name: 'Ambiguous' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`${base}/update/${number}`)
          .set('Authorization', auth())
          .send({ first_name: 'Scoped', from_phone_number_id: businessNumber })
      ).status,
    ).toBe(200);
    expect(
      (
        await db.contacts.findFirst({
          where: { vendorId: owner.vendorId, waId: number, wabPhoneNumberId: secondNumber },
        })
      )?.firstName,
    ).toBeNull();
    expect(
      (
        await request(app)
          .post(`${base}/update/${number}`)
          .set('Authorization', auth())
          .send({ first_name: 'Foreign', from_phone_number_id: '9876543210987' })
      ).status,
    ).toBe(400);
  });
  it('rejects invalid fields and duplicate creation including concurrent calls', async () => {
    for (const input of [
      { phone_number: '+919999999999' },
      { phone_number: '0123456789' },
      { phone_number: phone(), unknown_field: 'bad' },
      { phone_number: phone(), country: 'Unavailable ' + randomUUID() },
    ]) {
      expect(
        (await request(app).post(`${base}/create`).set('Authorization', auth()).send(input)).status,
      ).toBe(400);
    }
    const number = phone();
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`${base}/create`)
          .set('Authorization', auth())
          .send({ phone_number: number }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.contacts.count({ where: { vendorId: owner.vendorId, waId: number } })).toBe(1);
  });
});
