import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import argon2 from 'argon2';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { verifyPassword } from '../src/utils/passwords.js';
import * as passwords from '../src/utils/passwords.js';
import { businessFixture } from './fixtures.js';
const app = createApp();
afterEach(() => vi.restoreAllMocks());
afterAll(async () => db.$disconnect());
describe('Laravel password migration', () => {
  it('accepts a legacy short Laravel bcrypt password and upgrades it only after success', async () => {
    const f = await businessFixture(),
      old = await bcrypt.hash('old-pass', 4),
      hash = old.replace('$2b$', '$2y$');
    const user = await db.users.update({ where: { id: f.userId }, data: { password: hash } });
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'wrong' }))
        .status,
    ).toBe(401);
    expect((await db.users.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(hash);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'old-pass' });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
    const upgraded = (await db.users.findUniqueOrThrow({ where: { id: user.id } })).password;
    expect(upgraded.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(upgraded, 'old-pass')).toBe(true);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: 'old-pass' })
      ).status,
    ).toBe(200);
  });
  it('keeps email/phone verification mandatory for imported credentials', async () => {
    const f = await businessFixture(),
      password = await bcrypt.hash('legacy-pass', 4);
    const user = await db.users.update({
      where: { id: f.userId },
      data: { password, phoneVerifiedAt: null },
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: 'legacy-pass' })
      ).status,
    ).toBe(403);
    expect((await db.users.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(password);
  });
  it('rejects bcrypt truncation, malformed hashes and excessive work factors', async () => {
    const password = 'a'.repeat(72),
      hash = await bcrypt.hash(password, 4);
    expect((await verifyPassword(hash, `${password}suffix`)).valid).toBe(false);
    expect((await verifyPassword(hash, password)).valid).toBe(true);
    expect((await verifyPassword(hash.replace('$04$', '$31$'), password)).valid).toBe(false);
    expect((await verifyPassword('plaintext-password', 'plaintext-password')).valid).toBe(false);
    expect((await verifyPassword('$argon2id$invalid', 'test')).valid).toBe(false);
    expect(
      (await verifyPassword('$argon2id$v=19$m=999999999,t=2,p=1$salt$hash', 'test')).valid,
    ).toBe(false);
  });
  it('handles simultaneous first logins without losing sessions or overwriting an upgrade', async () => {
    const f = await businessFixture(),
      password = 'legacy-pass';
    const user = await db.users.update({
      where: { id: f.userId },
      data: { password: await bcrypt.hash(password, 4) },
    });
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app).post('/api/v1/auth/login').send({ email: user.email, password }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(
      (await db.users.findUniqueOrThrow({ where: { id: user.id } })).password.startsWith(
        '$argon2id$',
      ),
    ).toBe(true);
    for (const result of results)
      expect(
        (
          await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${result.body.accessToken}`)
        ).status,
      ).toBe(200);
  });
  it('does not overwrite a concurrent password reset or issue an old-credential session', async () => {
    const f = await businessFixture(),
      user = await db.users.update({
        where: { id: f.userId },
        data: { password: await bcrypt.hash('legacy-pass', 4) },
      });
    const replacement = await passwords.hashPassword('NewResetPassword!42'),
      originalVerify = passwords.verifyPassword;
    const count = await db.authSessions.count({ where: { userId: user.id } });
    vi.spyOn(passwords, 'verifyPassword').mockImplementationOnce(async (hash, password) => {
      const result = await originalVerify(hash, password);
      await db.users.update({ where: { id: user.id }, data: { password: replacement } });
      return result;
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: 'legacy-pass' })
      ).status,
    ).toBe(401);
    expect((await db.users.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(
      replacement,
    );
    expect(await db.authSessions.count({ where: { userId: user.id } })).toBe(count);
  });
});
