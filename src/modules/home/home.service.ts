import { db } from '../../database/client.js';
import { config } from '../../config/environment.js';
import { ApiError } from '../../shared/api-error.js';
import { readSiteSettings, siteSettingGroups } from '../configuration/services/site-settings.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { policies } from './home.constants.js';

export const siteKeys = [
  ...siteSettingGroups.general,
  'enable_vendor_registration',
  'message_for_disabled_registration',
  'other_home_page_url',
];
export function canonical(path: string) {
  return new URL(path, config.PUBLIC_URL).href;
}
export function normalizedUrl(url: string) {
  const result = new URL(url);
  result.hash = '';
  result.pathname = result.pathname.replace(/\/+$/, '') || '/';
  return result.href;
}

export { policies } from './home.constants.js';
export const titles = {
  user_terms: 'User terms',
  vendor_terms: 'Vendor terms',
  privacy_policy: 'Privacy Policy',
};
export async function getPublicHome(requestInput: ServiceContext) {
  const result = await db.$transaction(
    async (tx) => {
      const [{ settings }, navigation, latestBlogPosts] = await Promise.all([
        readSiteSettings(siteKeys, tx),
        tx.pages.findMany({
          where: { vendorId: null, status: 1, showInMenu: 1 },
          orderBy: { id: 'asc' },
          select: { uid: true, slug: true, title: true },
        }),
        tx.blogPosts.findMany({
          where: { status: 'published', deletedAt: null, publishedAt: { lte: new Date() } },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: 3,
          select: {
            uid: true,
            slug: true,
            title: true,
            excerpt: true,
            featuredImage: true,
            locale: true,
            publishedAt: true,
            refCategoryId: { select: { name: true, slug: true } },
          },
        }),
      ]);
      const alternate = settings.other_home_page_url as string;
      return {
        site: {
          name: settings.name,
          description: settings.description,
          contactEmail: settings.contact_email || null,
          contactDetails: settings.contact_details,
          timeZone: settings.timezone,
          demoVideoUrl: settings.demo_video_link || null,
          whatsappDemoUrl: settings.whatsapp_demo_link || null,
        },
        registration: {
          enabled: settings.enable_vendor_registration,
          message: settings.enable_vendor_registration
            ? null
            : settings.message_for_disabled_registration,
        },
        canonicalUrl: canonical('/'),
        redirectUrl:
          alternate && normalizedUrl(alternate) !== normalizedUrl(canonical('/'))
            ? alternate
            : null,
        navigation,
        latestBlogPosts: latestBlogPosts.map(({ refCategoryId, ...post }) => ({
          ...post,
          category: refCategoryId,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
  return serviceResult(result, { status: 200, format: 'json' });
}
export async function getPublicPolicy(requestInput: ServiceContext) {
  const policy = String(requestInput.params.policy) as (typeof policies)[number],
    { settings } = await readSiteSettings([policy]);
  if (!settings[policy]) throw new ApiError(404, 'NOT_FOUND', 'Policy is not published');
  return serviceResult(
    {
      id: policy,
      title: titles[policy],
      content: settings[policy],
      canonicalUrl: canonical(`/terms-and-policies/${policy}`),
    },
    { status: 200, format: 'json' },
  );
}
