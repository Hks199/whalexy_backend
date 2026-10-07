import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../src/database/client.js';
import { accessToken } from '../src/middleware/auth.js';
import { digest } from '../src/utils/crypto.js';
export async function businessFixture(permissions = ['*']) {
  const vendor = await db.vendors.create({ data: { title: `Test business ${randomUUID()}` } });
  const user = await db.users.create({
    data: {
      name: 'Test user',
      email: `${randomUUID()}@example.com`,
      password: await argon2.hash(randomUUID()),
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });
  await db.nativeMemberships.create({
    data: {
      vendorId: vendor.id,
      userId: user.id,
      role: permissions.includes('*') ? 'owner' : 'agent',
      permissions,
    },
  });
  const session = await db.authSessions.create({
    data: {
      userId: user.id,
      tokenHash: digest(randomUUID()),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { vendorId: vendor.id, userId: user.id, token: await accessToken(user.id, session.id) };
}
