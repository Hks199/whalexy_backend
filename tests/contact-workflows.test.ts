import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { accessToken } from '../src/middleware/auth.js';
import { digest, encrypt } from '../src/utils/crypto.js';
import { syncTemplates } from '../src/modules/integrations/integrations.service.js';

const app = createApp(),
  run = randomUUID();
let vendorId: number,
  otherVendorId: number,
  userId: number,
  contactId: number,
  otherContactId: number;
let token: string, agentToken: string, agentId: number, foreignLabelId: number;
const endpoint = (path: string) => `/api/v1/vendors/${vendorId}/${path}`;
const authorization = () => `Bearer ${token}`;
async function user(vendorId: number, permissions: string[]) {
  const account = await db.users.create({
    data: {
      name: 'Workflow tester',
      email: `${randomUUID()}@example.com`,
      password: await argon2.hash(randomUUID()),
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  });
  await db.nativeMemberships.create({
    data: {
      vendorId,
      userId: account.id,
      role: permissions.includes('*') ? 'owner' : 'agent',
      permissions,
    },
  });
  const session = await db.authSessions.create({
    data: {
      userId: account.id,
      tokenHash: digest(randomUUID()),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { userId: account.id, token: await accessToken(account.id, session.id) };
}
beforeAll(async () => {
  vendorId = (await db.vendors.create({ data: { title: `Workflows ${run}` } })).id;
  otherVendorId = (await db.vendors.create({ data: { title: `Foreign ${run}` } })).id;
  const owner = await user(vendorId, ['*']);
  token = owner.token;
  userId = owner.userId;
  const agent = await user(vendorId, [
    'vendor.contacts.view',
    'vendor.contacts.edit',
    'vendor.chats.view_assigned',
    'vendor.chats.reply',
  ]);
  agentToken = agent.token;
  agentId = agent.userId;
  contactId = (
    await db.contacts.create({
      data: {
        vendorId,
        firstName: 'Contact',
        waId: '919800000001',
        data: { unrelated_setting: true },
      },
    })
  ).id;
  otherContactId = (
    await db.contacts.create({
      data: { vendorId: otherVendorId, firstName: 'Foreign', waId: '919800000002' },
    })
  ).id;
  foreignLabelId = (
    await db.labels.create({ data: { vendorId: otherVendorId, title: 'Foreign label' } })
  ).id;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => db.$disconnect());

describe('contact data and authorization', () => {
  it('does not reset a social contact platform when updating unrelated fields', async () => {
    const contact = await db.contacts.create({
      data: { vendorId, platform: 'instagram', instagramId: `instagram-${run}` },
    });
    expect(
      (
        await request(app)
          .patch(endpoint(`contacts/${contact.id}`))
          .set('Authorization', authorization())
          .send({ firstName: 'Renamed' })
      ).status,
    ).toBe(200);
    expect((await db.contacts.findUnique({ where: { id: contact.id } }))?.platform).toBe(
      'instagram',
    );
    expect(
      (
        await request(app)
          .patch(endpoint(`contacts/${contact.id}`))
          .set('Authorization', authorization())
          .send({})
      ).status,
    ).toBe(400);
  });
  it('rejects invalid domain identifiers as client errors', async () => {
    for (const path of [
      'campaigns/not-an-id/status',
      'appointments/not-an-id',
      'resources/groups/99999999999999999999',
    ])
      expect(
        (await request(app).get(endpoint(path)).set('Authorization', authorization())).status,
      ).toBe(400);
  });
  it('writes notes while preserving unrelated JSON and denies foreign contacts', async () => {
    expect(
      (
        await request(app)
          .put(endpoint(`contacts/${contactId}/notes`))
          .set('Authorization', authorization())
          .send({ notes: 'Follow up tomorrow' })
      ).status,
    ).toBe(204);
    expect((await db.contacts.findUnique({ where: { id: contactId } }))?.data).toMatchObject({
      unrelated_setting: true,
      contact_notes: 'Follow up tomorrow',
    });
    const get = await request(app)
      .get(endpoint(`contacts/${contactId}/notes`))
      .set('Authorization', authorization());
    expect(get.body.notes).toBe('Follow up tomorrow');
    expect(
      (
        await request(app)
          .get(endpoint(`contacts/${otherContactId}/notes`))
          .set('Authorization', authorization())
      ).status,
    ).toBe(404);
  });
  it('denies unassigned agents and malformed IDs', async () => {
    expect(
      (
        await request(app)
          .put(endpoint(`contacts/${contactId}/notes`))
          .set('Authorization', `Bearer ${agentToken}`)
          .send({ notes: 'Denied' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(endpoint('contacts/not-an-id/resolve'))
          .set('Authorization', authorization())
          .send({ resolved: true })
      ).status,
    ).toBe(400);
  });
  it('replaces labels atomically and preserves labels on a rejected cross-business change', async () => {
    const label = await db.labels.create({
      data: { vendorId, title: 'Sales', textColor: '#111111', bgColor: '#eeeeee' },
    });
    expect(
      (
        await request(app)
          .put(endpoint(`contacts/${contactId}/labels`))
          .set('Authorization', authorization())
          .send({ labelIds: [label.id] })
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .put(endpoint(`contacts/${contactId}/labels`))
          .set('Authorization', authorization())
          .send({ labelIds: [foreignLabelId] })
      ).status,
    ).toBe(400);
    const get = await request(app)
      .get(endpoint(`contacts/${contactId}/labels`))
      .set('Authorization', authorization());
    expect(get.body.map((l: any) => l.id)).toEqual([label.id]);
    expect(
      (
        await request(app)
          .put(endpoint(`contacts/${contactId}/labels`))
          .set('Authorization', authorization())
          .send({ labelIds: [] })
      ).status,
    ).toBe(204);
    expect(await db.contactLabels.count({ where: { contactId } })).toBe(0);
  });
  it('upserts custom values once and rejects foreign definitions', async () => {
    const field = await db.contactCustomFields.create({
      data: { vendorId, inputName: 'company', inputType: 'text' },
    });
    const foreign = await db.contactCustomFields.create({
      data: { vendorId: otherVendorId, inputName: 'foreign', inputType: 'text' },
    });
    for (const value of ['First', 'Second'])
      expect(
        (
          await request(app)
            .put(endpoint(`contacts/${contactId}/custom-values`))
            .set('Authorization', authorization())
            .send({ values: [{ fieldId: field.id, value }] })
        ).status,
      ).toBe(204);
    expect(await db.contactCustomFieldValues.count({ where: { contactId } })).toBe(1);
    expect(
      (
        await request(app)
          .put(endpoint(`contacts/${contactId}/custom-values`))
          .set('Authorization', authorization())
          .send({ values: [{ fieldId: foreign.id, value: 'Denied' }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get(endpoint(`contacts/${contactId}/custom-values`))
          .set('Authorization', authorization())
      ).body,
    ).toEqual([{ contactCustomFieldsId: field.id, fieldValue: 'Second' }]);
  });
});

describe('source-derived group workflows', () => {
  it('merges unique members and removes the source group, matching the Laravel regression case', async () => {
    const source = await db.contactGroups.create({ data: { vendorId, title: 'Source' } });
    const target = await db.contactGroups.create({ data: { vendorId, title: 'Target' } });
    const second = await db.contacts.create({ data: { vendorId, waId: '919800000003' } });
    await db.groupContacts.createMany({
      data: [
        { groupId: source.id, contactId },
        { groupId: source.id, contactId: second.id },
        { groupId: target.id, contactId },
      ],
    });
    const merged = await request(app)
      .post(endpoint(`groups/${source.id}/merge`))
      .set('Authorization', authorization())
      .send({ targetGroupId: target.id });
    expect(merged.status).toBe(200);
    expect(merged.body.movedContactsCount).toBe(1);
    expect(await db.contactGroups.findUnique({ where: { id: source.id } })).toBeNull();
    expect(await db.groupContacts.count({ where: { groupId: target.id } })).toBe(2);
    const assigned = await request(app)
      .post(endpoint(`groups/${target.id}/assign`))
      .set('Authorization', authorization())
      .send({ userId: agentId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.assignedContactsCount).toBe(2);
    expect(
      await db.contacts.count({
        where: { vendorId, id: { in: [contactId, second.id] }, assignedUserId: agentId },
      }),
    ).toBe(2);
  });
  it('rejects merges across businesses and phone scopes without deleting the source', async () => {
    const source = await db.contactGroups.create({
      data: { vendorId, title: 'Source guarded', wabPhoneNumberId: 'phone-a' },
    });
    const foreign = await db.contactGroups.create({
      data: { vendorId: otherVendorId, title: 'Foreign' },
    });
    const scoped = await db.contactGroups.create({
      data: { vendorId, title: 'Other phone', wabPhoneNumberId: 'phone-b' },
    });
    expect(
      (
        await request(app)
          .post(endpoint(`groups/${source.id}/merge`))
          .set('Authorization', authorization())
          .send({ targetGroupId: foreign.id })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(endpoint(`groups/${source.id}/merge`))
          .set('Authorization', authorization())
          .send({ targetGroupId: scoped.id })
      ).status,
    ).toBe(409);
    expect(await db.contactGroups.findUnique({ where: { id: source.id } })).not.toBeNull();
  });
  it('uses source archive status 5 and forbids agents from bulk group administration', async () => {
    const group = await db.contactGroups.create({ data: { vendorId, title: 'Archive test' } });
    expect(
      (
        await request(app)
          .post(endpoint(`groups/${group.id}/archive`))
          .set('Authorization', authorization())
          .send({ archived: true })
      ).status,
    ).toBe(204);
    expect((await db.contactGroups.findUnique({ where: { id: group.id } }))?.status).toBe(5);
    expect(
      (
        await request(app)
          .post(endpoint(`groups/${group.id}/assign`))
          .set('Authorization', `Bearer ${agentToken}`)
          .send({ userId: agentId })
      ).status,
    ).toBe(403);
  });
  it('prevents duplicate group membership under concurrent linking', async () => {
    const group = await db.contactGroups.create({ data: { vendorId, title: 'Concurrent' } });
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(endpoint(`contacts/${contactId}/groups`))
          .set('Authorization', authorization())
          .send({ groupId: group.id }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([204, 204]);
    expect(await db.groupContacts.count({ where: { contactId, groupId: group.id } })).toBe(1);
  });
});

describe('CSV import and private export', () => {
  it('imports validated rows once and leaves existing contacts untouched', async () => {
    const group = await db.contactGroups.create({ data: { vendorId, title: 'Import' } });
    const input = {
      csv: 'First Name,Mobile Number,Email\nNew,919800000004,new@example.com\n',
      groupId: group.id,
    };
    const created = await request(app)
      .post(endpoint('contacts/import'))
      .set('Authorization', authorization())
      .send(input);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ created: 1, skipped: 0 });
    const again = await request(app)
      .post(endpoint('contacts/import'))
      .set('Authorization', authorization())
      .send(input);
    expect(again.body).toEqual({ created: 0, skipped: 1 });
    const contact = await db.contacts.findFirst({ where: { vendorId, waId: '919800000004' } });
    expect(contact?.firstName).toBe('New');
    expect(await db.groupContacts.count({ where: { groupId: group.id } })).toBe(1);
  });
  it('rejects malformed rows before creating any contacts and rejects ownership headers', async () => {
    const before = await db.contacts.count({ where: { vendorId } });
    for (const csv of [
      'phone,firstName\n+919800000005,Valid\ninvalid,Bad',
      'phone,vendorId\n+919800000005,999',
      'phone\n+919800000005\n+919800000005',
    ])
      expect(
        (
          await request(app)
            .post(endpoint('contacts/import'))
            .set('Authorization', authorization())
            .send({ csv })
        ).status,
      ).toBe(400);
    expect(await db.contacts.count({ where: { vendorId } })).toBe(before);
  });
  it('escapes spreadsheet formulas and limits an agent export to assigned, masked contacts', async () => {
    await db.contacts.update({
      where: { id: contactId },
      data: { firstName: '=HYPERLINK("https://attacker.example")', assignedUserId: agentId },
    });
    const exported = await request(app)
      .get(endpoint('contacts/export'))
      .set('Authorization', `Bearer ${agentToken}`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain("'=HYPERLINK");
    expect(exported.text).toContain('***0001');
    expect(exported.text).not.toContain('919800000001');
    expect(exported.text).not.toContain('new@example.com');
    expect(exported.text).not.toContain('Foreign');
  });
});

describe('paginated provider template sync', () => {
  async function credential() {
    const phone = `9988${vendorId}`;
    await db.integrationCredentials.upsert({
      where: {
        vendorId_provider_externalId: { vendorId, provider: 'whatsapp', externalId: phone },
      },
      create: {
        vendorId,
        provider: 'whatsapp',
        externalId: phone,
        secret: encrypt('test-template-token'),
      },
      update: {},
    });
    return phone;
  }
  it('reads every page using cursors on the fixed provider host', async () => {
    const phone = await credential();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: `template-1-${run}`, name: 'one', language: 'en', status: 'APPROVED' }],
            paging: {
              next: 'https://attacker.example/steal-token',
              cursors: { after: 'cursor+one' },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: `template-2-${run}`, name: 'two', language: 'en', status: 'APPROVED' }],
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await syncTemplates(vendorId, phone, '123456789');
    expect(result).toMatchObject({ synced: 2, pages: 2, hasMore: false });
    for (const [url] of fetchMock.mock.calls)
      expect((url as URL).hostname).toBe('graph.facebook.com');
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get('after')).toBe('cursor+one');
  });
  it('reports partial sync honestly and rejects cursor loops', async () => {
    const phone = await credential();
    const page = {
      data: [],
      paging: { next: 'https://graph.facebook.com/next', cursors: { after: 'repeat' } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(JSON.stringify(page))),
    );
    expect(await syncTemplates(vendorId, phone, '123456789', 1)).toMatchObject({
      hasMore: true,
      nextCursor: 'repeat',
    });
    await expect(syncTemplates(vendorId, phone, '123456789', 3)).rejects.toMatchObject({
      code: 'PROVIDER_PAGINATION',
    });
  });
});
