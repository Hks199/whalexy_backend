import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
afterAll(() => db.$disconnect());
describe('original mobile API adapters', () => {
  it('supports original API root methods and protects current-user fields', async () => {
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const)
      expect((await request(app)[verb]('/api')).text).toBe('api endpoint');
    expect((await request(app).get('/api/user')).status).toBe(401);
    const f = await businessFixture();
    const me = await request(app).get('/api/user').set('Authorization', `Bearer ${f.token}`);
    expect(me.status).toBe(200);
    expect(me.body._id).toBe(f.userId);
    expect(Object.keys(me.body).sort()).toEqual(
      [
        '_id',
        '_uid',
        'name',
        'first_name',
        'last_name',
        'username',
        'email',
        'mobile_number',
        'email_verified_at',
        'phone_verified_at',
      ].sort(),
    );
    expect(
      (await request(app).post('/api/user/logout').set('Authorization', `Bearer ${f.token}`)).body
        .reaction,
    ).toBe(1);
    expect(
      (await request(app).get('/api/user').set('Authorization', `Bearer ${f.token}`)).status,
    ).toBe(401);
  });
  it('accepts verified legacy username and phone logins without accepting ambiguous identities', async () => {
    const f = await businessFixture();
    const username = 'mobile_' + randomUUID(),
      phoneNumber = '+91' + String(f.vendorId).padStart(10, '0');
    await db.users.update({
      where: { id: f.userId },
      data: { username, phoneNumber, password: await bcrypt.hash('legacy-pass', 4) },
    });
    for (const email of [username, phoneNumber, phoneNumber.slice(1)]) {
      const result = await request(app)
        .post('/api/user/login-process')
        .send({ email, password: 'legacy-pass' });
      expect(result.status).toBe(200);
      expect(result.body.data.accessToken).toBeTruthy();
    }
    const other = await businessFixture();
    await db.users.update({ where: { id: other.userId }, data: { phoneNumber } });
    expect(
      (
        await request(app)
          .post('/api/user/login-process')
          .send({ email: phoneNumber, password: 'legacy-pass' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/user/login-process')
          .send({ email: username, password: 'wrong' })
      ).status,
    ).toBe(401);
  });
  it('provides registration requirements and creates an account awaiting verification', async () => {
    const prepared = await request(app).get('/api/user/prepare-sign-up');
    expect(prepared.status).toBe(200);
    expect(prepared.body.data.verification_required).toEqual(['email', 'phone']);
    const email = `${randomUUID()}@example.com`;
    const result = await request(app).post('/api/user/process-sign-up').send({
      first_name: 'Mobile',
      last_name: 'Owner',
      email,
      password: 'A-long-password-123',
      password_confirmation: 'A-long-password-123',
      phone_number: '+919876543210',
      business_name: 'Mobile Business',
    });
    expect(result.status).toBe(201);
    expect(result.body.data.verificationRequired).toEqual(['email', 'phone']);
    expect(result.body.data.accessToken).toBeUndefined();
    expect(
      (
        await request(app)
          .post('/api/user/login-process')
          .send({ email, password: 'A-long-password-123' })
      ).status,
    ).toBe(403);
  });
  it('scopes contact pages, selected contacts, assignment filters and phone privacy', async () => {
    const f = await businessFixture(['vendor.contacts.view']),
      other = await businessFixture();
    const own = await db.contacts.create({
      data: {
        vendorId: f.vendorId,
        assignedUserId: f.userId,
        waId: '919876543210',
        email: 'private@example.com',
        firstName: 'Visible',
      },
    });
    const hidden = await db.contacts.create({
      data: { vendorId: f.vendorId, firstName: 'Hidden' },
    });
    const foreign = await db.contacts.create({
      data: { vendorId: other.vendorId, firstName: 'Foreign' },
    });
    const read = (path = '', query = {}) =>
      request(app)
        .get('/api/vendor/contact/contacts-data' + path)
        .set('Authorization', `Bearer ${f.token}`)
        .query(query);
    const result = await read();
    expect(result.status).toBe(200);
    expect(Object.keys(result.body.data.contacts)).toEqual([own.uid]);
    expect(result.body.data.contacts[own.uid]).toMatchObject({ wa_id: '***3210', email: null });
    for (const contact of [hidden, foreign])
      expect((await read('/' + contact.uid)).status).toBe(404);
    expect((await read('', { assigned: 'unassigned' })).status).toBe(403);
    expect((await read('', { from_phone_number_id: '999999' })).status).toBe(400);
    const owner = await businessFixture();
    const selected = await db.contacts.create({
      data: { vendorId: owner.vendorId, firstName: 'Unassigned' },
    });
    expect(
      (
        await request(app)
          .get('/api/vendor/contact/contacts-data/' + selected.uid)
          .set('Authorization', `Bearer ${owner.token}`)
          .query({ assigned: 'mine' })
      ).status,
    ).toBe(404);
  });
});
