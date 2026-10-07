import { Prisma } from '@prisma/client';
import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import { currentContactPermissions } from '../../contact-workflows/services/contact-administration.service.js';
import { authorizePages } from '../../content/services/page-access.service.js';
import { scope as orderScope } from '../../whatsapp-orders/services/order-support.service.js';
const mask = (value: string | null) =>
  !value ? '' : '****' + (value.length > 4 ? value.slice(-4) : '');
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const output = (rows: any[]) =>
  serviceResult(rows, { status: 200, format: 'json', headers: { 'Cache-Control': 'no-store' } });
export async function vendorSearch(input: ServiceContext) {
  const rows = await db.$transaction(
    async (tx) => {
      const p = await currentContactPermissions(tx, input),
        has = (key: string) => p.includes('*') || p.includes(key),
        vendorId = input.identity!.vendorId!,
        q = input.validatedQuery.q;
      if (!has('vendor.dashboard.view'))
        throw new ApiError(403, 'FORBIDDEN', 'Dashboard access required');
      if (!q) return [];
      const phone = has('vendor.contacts.view_phone'),
        all = has('vendor.chats.view_all'),
        term = literal(q),
        results: any[] = [];
      if (has('vendor.contacts.view')) {
        if ('Contacts'.toLowerCase().includes(q.toLowerCase()))
          results.push({
            name: 'Contacts',
            path: 'Customer CRM / Contacts',
            url: `/api/v1/vendors/${vendorId}/contacts`,
            type: 'page',
            icon: 'fas fa-users',
          });
        const contacts = await tx.contacts.findMany({
          where: {
            vendorId,
            ...(!all ? { assignedUserId: input.identity!.userId } : {}),
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              ...(phone ? [{ waId: { contains: term, mode: 'insensitive' as const } }] : []),
            ],
          },
          select: { id: true, uid: true, firstName: true, lastName: true, waId: true },
          orderBy: { id: 'asc' },
          take: 5,
        });
        for (const c of contacts) {
          const display = phone ? (c.waId ?? '') : mask(c.waId),
            name =
              [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || display || 'Contact';
          results.push({
            name,
            path: 'Customer CRM / Contacts / ' + name,
            url: `/api/v1/vendors/${vendorId}/contacts/${c.id}`,
            type: 'contact',
            icon: 'fas fa-user',
            subtitle: display,
          });
        }
      }
      if (has('vendor.orders.manage') && all) {
        if ('WhatsApp Orders'.toLowerCase().includes(q.toLowerCase()))
          results.push({
            name: 'WhatsApp Orders',
            path: 'Customer CRM / Orders',
            url: '/vendor-console/whatsapp-orders',
            type: 'page',
            icon: 'fas fa-box',
          });
        const matches = [
          Prisma.sql`strpos(lower(o.order_id),lower(${q}))>0`,
          Prisma.sql`strpos(lower(coalesce(o.customer_name,'')),lower(${q}))>0`,
        ];
        if (phone) matches.push(Prisma.sql`strpos(o.customer_phone,${q})>0`);
        const orders = await tx.$queryRaw<
          {
            uid: string;
            orderId: string;
            customerName: string | null;
            customerPhone: string;
            currency: string;
            totalAmount: Prisma.Decimal;
          }[]
        >(
          Prisma.sql`SELECT o._uid AS uid,o.order_id AS "orderId",o.customer_name AS "customerName",o.customer_phone AS "customerPhone",o.currency,o.total_amount AS "totalAmount" FROM whatsapp_orders o WHERE ${orderScope(vendorId)} AND (${Prisma.join(matches, ' OR ')}) ORDER BY o._id ASC LIMIT 5`,
        );
        for (const o of orders) {
          const display = phone ? o.customerPhone : mask(o.customerPhone);
          results.push({
            name: 'Order #' + o.orderId,
            path: 'Customer CRM / Orders / #' + o.orderId,
            url: '/vendor-console/whatsapp-orders/' + encodeURIComponent(o.uid),
            type: 'order',
            icon: 'fas fa-box',
            subtitle:
              (o.customerName ? `${o.customerName} (${display})` : display) +
              ` - ${o.currency} ${o.totalAmount.toString()}`,
          });
        }
      }
      return results;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return output(rows);
}
export async function centralSearch(input: ServiceContext) {
  const rows = await db.$transaction(
    async (tx) => {
      await authorizePages(tx, input);
      const q = input.validatedQuery.q;
      if (!q) return [];
      const term = literal(q),
        results: any[] = [];
      const navigation = [
        {
          name: 'General Settings',
          path: 'Configuration / General',
          url: '/central-console/configuration/general',
          type: 'page',
          icon: 'fas fa-cogs',
        },
        {
          name: 'User Settings',
          path: 'Configuration / User',
          url: '/central-console/configuration/user',
          type: 'page',
          icon: 'fas fa-user-cog',
        },
        {
          name: 'Miscellaneous Settings',
          path: 'Configuration / Miscellaneous',
          url: '/central-console/configuration/misc_settings',
          type: 'page',
          icon: 'fas fa-cogs',
        },
      ];
      results.push(
        ...navigation.filter((n) =>
          (n.name + ' ' + n.path).toLowerCase().includes(q.toLowerCase()),
        ),
      );
      const [pages, posts] = await Promise.all([
        tx.pages.findMany({
          where: {
            vendorId: null,
            OR: [{ type: null }, { type: 1 }],
            AND: [
              {
                OR: [
                  { title: { contains: term, mode: 'insensitive' } },
                  { slug: { contains: term, mode: 'insensitive' } },
                ],
              },
            ],
          },
          select: { uid: true, title: true, slug: true },
          orderBy: { id: 'asc' },
          take: 5,
        }),
        tx.blogPosts.findMany({
          where: {
            deletedAt: null,
            OR: [
              { title: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term, mode: 'insensitive' } },
            ],
          },
          select: { id: true, title: true, slug: true },
          orderBy: { id: 'asc' },
          take: 5,
        }),
      ]);
      for (const p of pages)
        results.push({
          name: p.title,
          path: 'Settings / Pages / ' + p.title,
          url: `/central-console/pages/${p.uid}/get-update-data`,
          type: 'page',
          icon: 'fas fa-file',
          subtitle: p.slug,
        });
      for (const p of posts)
        results.push({
          name: p.title,
          path: 'Content / Blogs / ' + p.title,
          url: `/central-console/blogs/${p.id}/edit`,
          type: 'page',
          icon: 'fas fa-file-alt',
          subtitle: p.slug,
        });
      return results;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return output(rows);
}
