import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Contacts } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { db } from '../src/database/client.js';
import { businessFixture } from './fixtures.js';
const app = createApp(),
  base = '/vendor-console/contacts';
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function fixture(permissions = ['*']) {
  const f = await businessFixture(permissions);
  const contacts: Contacts[] = [];
  for (const firstName of ['First', 'Second'])
    contacts.push(
      await db.contacts.create({
        data: {
          vendorId: f.vendorId,
          assignedUserId: f.userId,
          firstName,
          platform: 'whatsapp',
          waId: '919876543210',
        },
      }),
    );
  const group = await db.contactGroups.create({
    data: { vendorId: f.vendorId, title: 'Deletion group' },
  });
  await db.groupContacts.createMany({
    data: contacts.map((c) => ({ contactId: c.id, groupId: group.id })),
  });
  const call = (path: string, body: Record<string, unknown>) =>
    request(app).post(`${base}/${path}`).set('Authorization', `Bearer ${f.token}`).send(body);
  const selected = (uids = contacts.map((c) => c.uid)) =>
    call('delete-selected-process', { selected_contacts: uids });
  const filtered = (body: Record<string, unknown> = {}, uid?: string) =>
    call(`delete-all-process${uid ? `/${uid}` : ''}`, body);
  return { ...f, contacts, group, selected, filtered };
}
async function queued(
  f: Awaited<ReturnType<typeof fixture>>,
  contactId: number,
  status = 'pending',
) {
  const message = await db.whatsappMessageLogs.create({
    data: {
      vendorId: f.vendorId,
      contactId,
      type: 'text',
      isIncomingMessage: false,
      status: 'queued',
      messagedAt: new Date(),
    },
  });
  const job = await db.outboxJobs.create({
    data: {
      vendorId: f.vendorId,
      kind: 'whatsapp-send',
      status,
      payload: { messageId: message.id },
    },
  });
  return { message, job };
}
describe('original bulk contact deletion', () => {
  it('deletes the entire selected batch and links, cancelling queued delivery with one audit per contact', async () => {
    const f = await fixture(),
      { job } = await queued(f, f.contacts[0].id);
    const result = await f.selected();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      deletedContactsCount: 2,
      reloadDatatableId: '#lwContactList',
    });
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.groupContacts.count({ where: { groupId: f.group.id } })).toBe(0);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'cancelled',
    );
    expect(
      await db.auditEvents.count({
        where: { vendorId: f.vendorId, resource: 'contact', action: 'delete' },
      }),
    ).toBe(2);
  });
  it('rolls back earlier contact cleanup when the later member is a campaign test contact or retained history', async () => {
    const f = await fixture(),
      { job } = await queued(f, f.contacts[0].id);
    const setting = await db.vendorSettings.create({
      data: { vendorId: f.vendorId, name: 'test_recipient_contact', value: f.contacts[1].uid },
    });
    expect((await f.selected()).body.error.code).toBe('CAMPAIGN_TEST_CONTACT');
    await db.vendorSettings.delete({ where: { id: setting.id } });
    await db.aiConversationHandoffs.create({
      data: {
        vendorId: f.vendorId,
        contactId: f.contacts[1].id,
        status: 'resolved',
        severity: 'normal',
        reason: 'history',
        requestedAt: new Date(),
      },
    });
    expect((await f.selected()).body.error.code).toBe('CONTACT_REFERENCES_PENDING');
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(2);
    expect(await db.groupContacts.count({ where: { groupId: f.group.id } })).toBe(2);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    );
    expect(await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'delete' } })).toBe(
      0,
    );
  });
  it('rejects a processing send without partial deletion of earlier members', async () => {
    const f = await fixture(),
      pending = await queued(f, f.contacts[0].id),
      processing = await queued(f, f.contacts[1].id, 'processing');
    expect((await f.selected()).body.error.code).toBe('CONTACT_SEND_IN_PROGRESS');
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(2);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: pending.job.id } })).status).toBe(
      'pending',
    );
    expect(
      (await db.outboxJobs.findUniqueOrThrow({ where: { id: processing.job.id } })).status,
    ).toBe('processing');
  });
  it('rolls back the full batch when the second deletion audit fails', async () => {
    const f = await fixture(),
      { job } = await queued(f, f.contacts[0].id),
      transaction = db.$transaction.bind(db);
    let writes = 0;
    vi.spyOn(db, '$transaction').mockImplementationOnce(((operation: any, options: any) =>
      transaction(
        async (tx) =>
          operation(
            new Proxy(tx, {
              get(target, key, receiver) {
                return key === 'auditEvents'
                  ? {
                      ...tx.auditEvents,
                      create: async (args: any) => {
                        if (++writes === 2) throw new Error('audit unavailable');
                        return tx.auditEvents.create(args);
                      },
                    }
                  : Reflect.get(target, key, receiver);
              },
            }),
          ),
        options,
      )) as any);
    expect((await f.selected()).status).toBe(500);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(2);
    expect((await db.outboxJobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    );
    expect(await db.auditEvents.count({ where: { vendorId: f.vendorId, action: 'delete' } })).toBe(
      0,
    );
  });
  it('keeps platform/search/group scopes and treats an empty or missing group safely', async () => {
    const f = await fixture();
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { platform: 'messenger' } });
    expect((await f.filtered({ search: 'FIRST' }, f.group.uid)).body.deletedContactsCount).toBe(1);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(1);
    const empty = await db.contactGroups.create({ data: { vendorId: f.vendorId, title: 'Empty' } });
    expect((await f.filtered({ platform: 'facebook' }, empty.uid)).body.deletedContactsCount).toBe(
      0,
    );
    expect((await f.filtered({}, randomUUID())).status).toBe(404);
    expect(
      (await f.filtered({ platform: 'facebook' }, f.group.uid)).body.deletedContactsCount,
    ).toBe(1);
  });
  it('restricts selected visibility and forbids filtered deletion for assigned-only actors or hidden phone searches', async () => {
    const f = await fixture(['vendor.contacts.delete', 'vendor.chats.view_assigned']);
    await db.contacts.update({ where: { id: f.contacts[1].id }, data: { assignedUserId: null } });
    expect((await f.selected()).status).toBe(404);
    expect((await f.filtered()).status).toBe(403);
    expect((await f.selected([f.contacts[0].uid])).body.deletedContactsCount).toBe(1);
    const full = await fixture(['vendor.contacts.delete', 'vendor.chats.view_all']);
    expect((await full.filtered({ search: '919876543210' })).body.deletedContactsCount).toBe(0);
    expect(await db.contacts.count({ where: { vendorId: full.vendorId } })).toBe(2);
  });
  it('rejects foreign/missing selected records, foreign groups and invalid selections', async () => {
    const f = await fixture(),
      foreign = await fixture();
    expect((await f.selected([f.contacts[0].uid, foreign.contacts[0].uid])).status).toBe(404);
    expect((await f.selected([f.contacts[0].uid, randomUUID()])).status).toBe(404);
    expect((await f.filtered({}, foreign.group.uid)).status).toBe(404);
    for (const uids of [
      [],
      [f.contacts[0].uid, f.contacts[0].uid],
      ['invalid'],
      Array.from({ length: 101 }, () => randomUUID()),
    ])
      expect((await f.selected(uids)).status).toBe(400);
    expect((await f.filtered({ platform: 'other' })).status).toBe(400);
    expect((await f.filtered({ vendorId: f.vendorId })).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`${base}/delete-selected-process`)
          .send({ selected_contacts: [f.contacts[0].uid] })
      ).status,
    ).toBe(401);
    expect(await db.contacts.count({ where: { vendorId: f.vendorId } })).toBe(2);
  });
  it('bounds filtered deletion before writing and applies connected sender only to general listings', async () => {
    const f = await fixture(),
      phone = `12345${f.vendorId}`;
    await db.integrationCredentials.create({
      data: {
        vendorId: f.vendorId,
        provider: 'whatsapp',
        externalId: phone,
        secret: 'unused-local-test-value',
      },
    });
    await db.contacts.update({
      where: { id: f.contacts[0].id },
      data: { wabPhoneNumberId: phone },
    });
    expect((await f.filtered({ from_phone_number_id: phone })).body.deletedContactsCount).toBe(1);
    expect((await f.filtered({ from_phone_number_id: '999999999' })).body.error.code).toBe(
      'INVALID_PHONE_SCOPE',
    );
    expect(
      (await f.filtered({ from_phone_number_id: phone }, f.group.uid)).body.deletedContactsCount,
    ).toBe(1);
    const large = await fixture();
    await db.contacts.createMany({
      data: Array.from({ length: 99 }, () => ({ vendorId: large.vendorId, platform: 'whatsapp' })),
    });
    expect((await large.filtered()).body.error.code).toBe('DELETE_BATCH_TOO_LARGE');
    expect(await db.contacts.count({ where: { vendorId: large.vendorId } })).toBe(101);
  });
});
