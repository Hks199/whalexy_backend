import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { encrypt } from '../src/utils/crypto.js';
import { processJob } from '../src/jobs/dispatcher.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
afterAll(() => db.$disconnect());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions),
    phone = `8822${f.vendorId}`,
    otherPhone = `9933${f.vendorId}`;
  await db.integrationCredentials.createMany({
    data: [phone, otherPhone].map((externalId) => ({
      vendorId: f.vendorId,
      provider: 'whatsapp',
      externalId,
      secret: encrypt('test-phone-token'),
    })),
  });
  return {
    ...f,
    phone,
    otherPhone,
    path: `/api/v1/vendors/${f.vendorId}/contacts`,
    auth: `Bearer ${f.token}`,
  };
}
async function contact(f: Awaited<ReturnType<typeof fixture>>) {
  return db.contacts.create({
    data: {
      vendorId: f.vendorId,
      waId: '919876543210',
      wabPhoneNumberId: f.phone,
      platform: 'whatsapp',
    },
  });
}

describe('business-number contact scope', () => {
  it('creates scoped contacts only for a connected business number and disallows scope transfer', async () => {
    const f = await fixture(),
      other = await fixture();
    const created = await request(app)
      .post(f.path)
      .set('Authorization', f.auth)
      .send({ phone: '+919876543210', phoneNumberId: f.phone });
    expect(created.status).toBe(201);
    expect(created.body.wabPhoneNumberId).toBe(f.phone);
    expect(
      (
        await request(app)
          .post(f.path)
          .set('Authorization', f.auth)
          .send({ phone: '+919876543211', phoneNumberId: other.phone })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`${f.path}/${created.body.id}`)
          .set('Authorization', f.auth)
          .send({ phoneNumberId: f.otherPhone })
      ).status,
    ).toBe(409);
  });
  it('imports into the group phone scope and keeps identical customer phones distinct across numbers', async () => {
    const f = await fixture(),
      a = await db.contactGroups.create({
        data: { vendorId: f.vendorId, title: 'A', wabPhoneNumberId: f.phone },
      }),
      b = await db.contactGroups.create({
        data: { vendorId: f.vendorId, title: 'B', wabPhoneNumberId: f.otherPhone },
      });
    const csv = 'phone,firstName\n+919876543210,Customer';
    const aa = await request(app)
        .post(`${f.path}/import`)
        .set('Authorization', f.auth)
        .send({ csv, groupId: a.id }),
      bb = await request(app)
        .post(`${f.path}/import`)
        .set('Authorization', f.auth)
        .send({ csv, groupId: b.id });
    expect(aa.status).toBe(201);
    expect(bb.status).toBe(201);
    expect(aa.body.created).toBe(1);
    expect(bb.body.created).toBe(1);
    const again = await request(app)
      .post(`${f.path}/import`)
      .set('Authorization', f.auth)
      .send({ csv, groupId: a.id });
    expect(again.body).toEqual({ created: 0, skipped: 1 });
    expect(await db.contacts.count({ where: { vendorId: f.vendorId, waId: '919876543210' } })).toBe(
      2,
    );
    expect(
      (
        await request(app)
          .post(`${f.path}/import`)
          .set('Authorization', f.auth)
          .send({ csv, groupId: a.id, phoneNumberId: f.otherPhone })
      ).status,
    ).toBe(409);
  });
});

describe('contact deletion and queued effects', () => {
  it('deletes owned contacts and restrictive links while cancelling queued messages', async () => {
    const f = await fixture(),
      c = await contact(f),
      group = await db.contactGroups.create({ data: { vendorId: f.vendorId, title: 'Group' } });
    await db.groupContacts.create({ data: { contactId: c.id, groupId: group.id } });
    const field = await db.contactCustomFields.create({
      data: {
        vendorId: f.vendorId,
        inputName: `field_${randomUUID()}`,
        inputType: 'text',
        name: 'Field',
      },
    });
    await db.contactCustomFieldValues.create({
      data: { contactId: c.id, contactCustomFieldsId: field.id, fieldValue: 'Value' },
    });
    const message = await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: c.id,
        contactWaId: c.waId,
        wabPhoneNumberId: f.phone,
        isIncomingMessage: false,
        type: 'text',
        status: 'queued',
        message: 'Queued',
        messagedAt: new Date(),
      },
    });
    const job = await db.outboxJobs.create({
      data: {
        vendorId: f.vendorId,
        kind: 'whatsapp-send',
        payload: {
          messageId: message.id,
          phoneNumberId: f.phone,
          payload: { to: c.waId, type: 'text', text: { body: 'Queued' } },
        },
      },
    });
    expect(
      (await request(app).delete(`${f.path}/${c.id}`).set('Authorization', f.auth)).status,
    ).toBe(204);
    expect(await db.contacts.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.groupContacts.count({ where: { contactId: c.id } })).toBe(0);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'cancelled',
    );
    await expect(processJob(job)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('protects configured campaign test contacts and in-flight sends without partial deletion', async () => {
    const f = await fixture(),
      c = await contact(f);
    const setting = await db.vendorSettings.create({
      data: { vendorId: f.vendorId, name: 'test_recipient_contact', value: c.uid },
    });
    expect(
      (await request(app).delete(`${f.path}/${c.id}`).set('Authorization', f.auth)).status,
    ).toBe(409);
    await db.vendorSettings.delete({ where: { id: setting.id } });
    const message = await db.whatsappMessageLogs.create({
      data: {
        vendorId: f.vendorId,
        contactId: c.id,
        isIncomingMessage: false,
        type: 'text',
        status: 'queued',
        messagedAt: new Date(),
      },
    });
    await db.outboxJobs.create({
      data: {
        vendorId: f.vendorId,
        kind: 'whatsapp-send',
        status: 'processing',
        payload: { messageId: message.id },
      },
    });
    expect(
      (await request(app).delete(`${f.path}/${c.id}`).set('Authorization', f.auth)).status,
    ).toBe(409);
    expect(await db.contacts.findUnique({ where: { id: c.id } })).not.toBeNull();
    expect(await db.whatsappMessageLogs.findUnique({ where: { id: message.id } })).not.toBeNull();
  });
  it('denies foreign and unassigned contacts and requires explicit delete permission', async () => {
    const f = await fixture(),
      other = await fixture(),
      foreign = await contact(other),
      c = await contact(f);
    expect(
      (await request(app).delete(`${f.path}/${foreign.id}`).set('Authorization', f.auth)).status,
    ).toBe(404);
    const agent = await businessFixture(['vendor.contacts.delete']);
    await db.nativeMemberships.create({
      data: {
        vendorId: f.vendorId,
        userId: agent.userId,
        role: 'agent',
        permissions: ['vendor.contacts.delete'],
      },
    });
    expect(
      (await request(app).delete(`${f.path}/${c.id}`).set('Authorization', `Bearer ${agent.token}`))
        .status,
    ).toBe(404);
    await db.nativeMemberships.update({
      where: { vendorId_userId: { vendorId: f.vendorId, userId: agent.userId } },
      data: { permissions: ['vendor.contacts.edit', 'vendor.chats.view_all'] },
    });
    expect(
      (await request(app).delete(`${f.path}/${c.id}`).set('Authorization', `Bearer ${agent.token}`))
        .status,
    ).toBe(403);
  });
});
