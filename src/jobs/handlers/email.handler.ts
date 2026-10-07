import { type OutboxJobs } from '@prisma/client';
import nodemailer from 'nodemailer';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { decrypt } from '../../utils/crypto.js';

export async function handleEmailDelivery(job: OutboxJobs) {
  const payload = job.payload as any;

  const message = JSON.parse(decrypt(payload.envelope));
  if (typeof message.challengeId !== 'string')
    throw new ApiError(503, 'MAIL_HANDLER_PENDING', 'Unverified email envelope');
  const challenge = await db.verificationChallenges.findUnique({
    where: { id: message.challengeId },
  });
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt <= new Date() ||
    challenge.kind !== message.kind ||
    (payload.challengeId && payload.challengeId !== message.challengeId)
  )
    return;
  const recipient = await db.users.findUnique({
    where: { id: challenge.userId },
    select: { email: true, status: true },
  });
  if (recipient?.status !== 1 || recipient.email !== message.to) return;
  const host = process.env.SMTP_HOST,
    from = process.env.MAIL_FROM;
  if (!host || !from)
    throw new ApiError(503, 'MAIL_NOT_CONFIGURED', 'Mail delivery is not configured');
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    requireTLS: true,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 15000,
    socketTimeout: 15000,
  });
  await transport.sendMail({
    from,
    to: message.to,
    subject: message.kind === 'email' ? 'Verify your Whalexy email' : 'Reset your Whalexy password',
    text:
      message.kind === 'email'
        ? `Your verification code is ${message.code}. It expires in 15 minutes.`
        : `Reset token: ${message.code}\nChallenge: ${message.challengeId}\nExpires in 15 minutes.`,
  });
  return;
}
