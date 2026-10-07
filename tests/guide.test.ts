import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { digest } from '../src/utils/crypto.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
let owner: Awaited<ReturnType<typeof businessFixture>>, other: typeof owner, agent: typeof owner;
const phone = `guide-${randomUUID()}`;
const path = () => `/api/v1/vendors/${owner.vendorId}/guide`;
async function guide() {
  const response = await request(app).get(path()).set('Authorization', `Bearer ${owner.token}`);
  expect(response.status).toBe(200);
  return response.body;
}
beforeAll(async () => {
  [owner, other, agent] = await Promise.all([
    businessFixture(),
    businessFixture(),
    businessFixture(['administrative', 'vendor.dashboard.view']),
  ]);
});
afterAll(async () => {
  const vendors = [owner.vendorId, other.vendorId, agent.vendorId],
    users = [owner.userId, other.userId, agent.userId];
  for (const model of [
    'apiKeys',
    'subscriptions',
    'whatsappMessageLogs',
    'campaigns',
    'botReplies',
    'botFlows',
    'contacts',
    'whatsappTemplates',
    'whatsappOnboardingConnections',
    'integrationCredentials',
    'nativeMemberships',
  ] as const)
    await (db[model] as any).deleteMany({ where: { vendorId: { in: vendors } } });
  await db.authSessions.deleteMany({ where: { userId: { in: users } } });
  await db.vendors.deleteMany({ where: { id: { in: vendors } } });
  await db.users.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
describe('workspace learning centre progress', () => {
  it('requires an authenticated workspace owner and excludes agents, API keys and other businesses', async () => {
    expect((await request(app).get(path())).status).toBe(401);
    expect(
      (await request(app).get(path()).set('Authorization', `Bearer ${other.token}`)).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/v1/vendors/${agent.vendorId}/guide`)
          .set('Authorization', `Bearer ${agent.token}`)
      ).status,
    ).toBe(403);
    const key = randomUUID();
    await db.apiKeys.create({
      data: {
        vendorId: owner.vendorId,
        userId: owner.userId,
        keyHash: digest(key),
        permissions: ['administrative', 'vendor.dashboard.view'],
      },
    });
    expect((await request(app).get(path()).set('Authorization', `ApiKey ${key}`)).status).toBe(403);
  });
  it('does not count another workspace or draft/archived records as ready', async () => {
    await db.whatsappTemplates.create({
      data: {
        vendorId: other.vendorId,
        templateName: 'other',
        languageCode: 'en',
        status: 'APPROVED',
      },
    });
    await db.contacts.create({ data: { vendorId: other.vendorId, status: 1 } });
    await db.whatsappTemplates.create({
      data: {
        vendorId: owner.vendorId,
        templateName: 'draft',
        languageCode: 'en',
        status: 'DRAFT',
      },
    });
    await db.contacts.create({ data: { vendorId: owner.vendorId, status: 0 } });
    await db.botFlows.create({
      data: { vendorId: owner.vendorId, title: 'Legacy', status: 'active', data: { nodes: [] } },
    });
    const result = await guide();
    expect(result.checklist.map((step: any) => step.done)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(result.showSubscriptionOffer).toBe(true);
  });
  it('requires a connected number and matching encrypted credential ownership', async () => {
    await db.whatsappOnboardingConnections.create({
      data: {
        vendorId: owner.vendorId,
        wabaId: 'guide-waba',
        phoneNumberId: phone,
        status: 'CONNECTED',
      },
    });
    expect((await guide()).checklist.find((s: any) => s.id === 'whatsapp').done).toBe(false);
    const credential = await db.integrationCredentials.create({
      data: {
        vendorId: owner.vendorId,
        provider: 'whatsapp',
        externalId: phone,
        secret: 'test-secret-not-published',
        metadata: { wabaId: 'wrong-waba' },
      },
    });
    expect((await guide()).checklist.find((s: any) => s.id === 'whatsapp').done).toBe(false);
    await db.integrationCredentials.update({
      where: { id: credential.id },
      data: { metadata: { wabaId: 'guide-waba' } },
    });
    const result = await guide();
    expect(result.checklist.find((s: any) => s.id === 'whatsapp').done).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/test-secret|guide-waba/);
    await db.integrationCredentials.delete({ where: { id: credential.id } });
    expect((await guide()).checklist.find((s: any) => s.id === 'whatsapp').done).toBe(false);
  });
  it('reports active setup, accepted sends and native automation', async () => {
    await db.whatsappTemplates.create({
      data: {
        vendorId: owner.vendorId,
        templateName: 'ready',
        languageCode: 'en',
        status: 'APPROVED',
      },
    });
    const contact = await db.contacts.create({ data: { vendorId: owner.vendorId, status: 1 } });
    const message = await db.whatsappMessageLogs.create({
      data: {
        vendorId: owner.vendorId,
        contactId: contact.id,
        isIncomingMessage: false,
        status: 'queued',
        messagedAt: new Date(),
      },
    });
    expect((await guide()).checklist.find((s: any) => s.id === 'campaign').done).toBe(false);
    await db.whatsappMessageLogs.update({ where: { id: message.id }, data: { status: 'sent' } });
    await db.botFlows.create({
      data: {
        vendorId: owner.vendorId,
        title: 'Native',
        status: 'active',
        data: { nativeGraphVersion: 1 },
      },
    });
    expect(
      (await guide()).checklist
        .filter((s: any) => ['template', 'contacts', 'campaign', 'automation'].includes(s.id))
        .every((s: any) => s.done),
    ).toBe(true);
  });
  it('uses current base-plan entitlement and excludes an AI-only add-on', async () => {
    const subscription = await db.subscriptions.create({
      data: {
        vendorId: owner.vendorId,
        type: 'addon_ai_replies',
        stripeId: `guide-${randomUUID()}`,
        stripeStatus: 'active',
      },
    });
    expect((await guide()).showSubscriptionOffer).toBe(true);
    await db.subscriptions.update({
      where: { id: subscription.id },
      data: { type: 'default', endsAt: new Date(Date.now() + 3600000) },
    });
    expect((await guide()).showSubscriptionOffer).toBe(false);
    await db.subscriptions.update({
      where: { id: subscription.id },
      data: { endsAt: new Date(Date.now() - 3600000) },
    });
    expect((await guide()).showSubscriptionOffer).toBe(true);
  });
});
