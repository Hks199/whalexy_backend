import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { decrypt } from '../src/utils/crypto.js';
import { hashPassword } from '../src/utils/passwords.js';
import { issueChallenge } from '../src/modules/auth/auth.service.js';
import { processJob } from '../src/jobs/dispatcher.js';
const app = createApp();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => db.$disconnect());
async function fixture() {
  const password = 'Verification password 123!',
    email = `${randomUUID()}@example.com`;
  const user = await db.users.create({
    data: {
      name: 'Pending user',
      email,
      password: await hashPassword(password),
      phoneNumber: '+919876543210',
    },
  });
  return { user, password, email };
}
async function mail(challengeId: string) {
  const all = await db.outboxJobs.findMany({ where: { kind: 'email' } });
  const job = all.find(
    (j) =>
      (j.payload as any).challengeId === challengeId ||
      JSON.parse(decrypt((j.payload as any).envelope)).challengeId === challengeId,
  )!;
  return { job, envelope: JSON.parse(decrypt((job.payload as any).envelope)) };
}
const resend = (f: Awaited<ReturnType<typeof fixture>>, password = f.password) =>
  request(app).post('/api/v1/auth/resend-verification').send({ email: f.email, password });
describe('verification challenge rotation and resend', () => {
  it('requires valid credentials, enforces cooldown and rejects fully verified accounts', async () => {
    const f = await fixture();
    expect((await resend(f, 'wrong')).status).toBe(401);
    expect((await resend({ ...f, email: `${randomUUID()}@example.com` })).status).toBe(401);
    const sent = await resend(f);
    expect(sent.status).toBe(202);
    expect(sent.body.code).toBeUndefined();
    expect((await resend(f)).status).toBe(429);
    await db.users.update({
      where: { id: f.user.id },
      data: { emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() },
    });
    expect((await resend(f)).status).toBe(409);
  });
  it('allows only one concurrent resend and invalidates the previous code', async () => {
    const f = await fixture(),
      oldId = await issueChallenge(f.user.id, 'email'),
      old = await mail(oldId);
    await db.verificationChallenges.update({
      where: { id: oldId },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    const results = await Promise.all([resend(f), resend(f)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(
      await db.verificationChallenges.count({
        where: { userId: f.user.id, kind: 'email', consumedAt: null },
      }),
    ).toBe(1);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/verify-email')
          .send({ challengeId: oldId, code: old.envelope.code })
      ).status,
    ).toBe(400);
    const freshId = results.find((r) => r.status === 202)!.body.challengeId,
      fresh = await mail(freshId);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/verify-email')
          .send({ challengeId: freshId, code: fresh.envelope.code })
      ).status,
    ).toBe(204);
  });
  it('rotates expired phone-verification proof without keeping the old consumed code valid', async () => {
    const f = await fixture(),
      oldId = await issueChallenge(f.user.id, 'email'),
      old = await mail(oldId);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/verify-email')
          .send({ challengeId: oldId, code: old.envelope.code })
      ).status,
    ).toBe(204);
    await db.verificationChallenges.update({
      where: { id: oldId },
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    const sent = await resend(f);
    expect(sent.status).toBe(202);
    expect(sent.body.verificationRequired).toEqual(['email', 'phone']);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/phone/start')
          .send({ challengeId: oldId, emailCode: old.envelope.code })
      ).status,
    ).toBe(401);
    const fresh = await mail(sent.body.challengeId);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/verify-email')
          .send({ challengeId: sent.body.challengeId, code: fresh.envelope.code })
      ).status,
    ).toBe(204);
  });
  it('serializes challenge creation and rejects a changed password before issuing a new proof', async () => {
    const f = await fixture();
    await Promise.all([issueChallenge(f.user.id, 'email'), issueChallenge(f.user.id, 'email')]);
    expect(
      await db.verificationChallenges.count({
        where: { userId: f.user.id, kind: 'email', consumedAt: null },
      }),
    ).toBe(1);
    const before = await db.verificationChallenges.count({ where: { userId: f.user.id } });
    await db.users.update({
      where: { id: f.user.id },
      data: { password: await hashPassword('Changed password 123!') },
    });
    await expect(
      issueChallenge(f.user.id, 'email', { expectedPassword: f.user.password }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(await db.verificationChallenges.count({ where: { userId: f.user.id } })).toBe(before);
  });
  it('skips superseded/consumed email jobs and supports legacy encrypted envelopes', async () => {
    const f = await fixture(),
      first = await issueChallenge(f.user.id, 'email'),
      old = await mail(first),
      second = await issueChallenge(f.user.id, 'email'),
      fresh = await mail(second);
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('MAIL_FROM', 'service@example.com');
    const sendMail = vi.fn().mockResolvedValue({});
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as any);
    await processJob(old.job);
    expect(sendMail).not.toHaveBeenCalled();
    await processJob({ ...fresh.job, payload: { envelope: (fresh.job.payload as any).envelope } });
    expect(sendMail).toHaveBeenCalledTimes(1);
    await db.verificationChallenges.update({
      where: { id: second },
      data: { consumedAt: new Date() },
    });
    await processJob(fresh.job);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it('does not deliver a verification email after the account destination changes', async () => {
    const f = await fixture(),
      id = await issueChallenge(f.user.id, 'email'),
      job = (await mail(id)).job;
    await db.users.update({
      where: { id: f.user.id },
      data: { email: `${randomUUID()}@example.com` },
    });
    const sendMail = vi.fn();
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as any);
    await processJob(job);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
