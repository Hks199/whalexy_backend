import { randomInt } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';

const app = createApp();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());
function body() {
  return {
    provider: 'whatsapp',
    externalId: `7700${randomInt(10000000, 99999999)}`,
    wabaId: '8877665544',
    accessToken: 'test-meta-token-with-sufficient-length',
  };
}
function remote(id: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ id }), { headers: { 'content-type': 'application/json' } }),
    ),
  );
}
function connect(f: Awaited<ReturnType<typeof businessFixture>>, data: ReturnType<typeof body>) {
  return request(app)
    .post(`/api/v1/vendors/${f.vendorId}/integrations/meta`)
    .set('Authorization', `Bearer ${f.token}`)
    .send(data);
}

describe('Meta connection lifecycle', () => {
  it('serializes simultaneous ownership claims after both initial checks pass', async () => {
    const a = await businessFixture(),
      b = await businessFixture(),
      data = body();
    remote(data.externalId);
    const original = db.integrationCredentials.findFirst.bind(db.integrationCredentials);
    let initialChecks = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(db.integrationCredentials, 'findFirst').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (args.where?.externalId === data.externalId && ++initialChecks <= 2) {
        if (initialChecks === 2) release();
        await gate;
      }
      return result;
    }) as any);
    const responses = await Promise.all([connect(a, data), connect(b, data)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const credentials = await db.integrationCredentials.findMany({
      where: { provider: 'whatsapp', externalId: data.externalId },
    });
    expect(credentials).toHaveLength(1);
    expect(
      (
        await db.whatsappOnboardingConnections.findUniqueOrThrow({
          where: { phoneNumberId: data.externalId },
        })
      ).vendorId,
    ).toBe(credentials[0].vendorId);
  });
  it('rolls back credential creation when a legacy onboarding number belongs to another business', async () => {
    const a = await businessFixture(),
      b = await businessFixture(),
      data = body();
    remote(data.externalId);
    await db.whatsappOnboardingConnections.create({
      data: {
        onboardingId: data.externalId,
        vendorId: b.vendorId,
        phoneNumberId: data.externalId,
        wabaId: data.wabaId,
        status: 'CONNECTED',
      },
    });
    expect((await connect(a, data)).status).toBe(409);
    expect(await db.integrationCredentials.count({ where: { externalId: data.externalId } })).toBe(
      0,
    );
  });
  it('disconnects onboarding locally and rejects foreign disconnect attempts', async () => {
    const a = await businessFixture(),
      b = await businessFixture(),
      data = body();
    remote(data.externalId);
    const response = await connect(a, data);
    expect(response.status).toBe(201);
    const path = `/api/v1/vendors/${b.vendorId}/integrations/${response.body.id}`;
    expect((await request(app).delete(path).set('Authorization', `Bearer ${b.token}`)).status).toBe(
      404,
    );
    expect(
      (
        await request(app)
          .delete(`/api/v1/vendors/${a.vendorId}/integrations/${response.body.id}`)
          .set('Authorization', `Bearer ${a.token}`)
      ).status,
    ).toBe(204);
    expect(
      await db.integrationCredentials.findUnique({ where: { id: response.body.id } }),
    ).toBeNull();
    expect(
      (
        await db.whatsappOnboardingConnections.findUniqueOrThrow({
          where: { phoneNumberId: data.externalId },
        })
      ).status,
    ).toBe('DISCONNECTED');
  });
});
