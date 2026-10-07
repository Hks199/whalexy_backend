# content

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router              | Mounted prefix           |
| ------------------- | ------------------------ |
| legacyPagesRouter   | `/central-console/pages` |
| legacyBlogsRouter   | `/central-console/blogs` |
| publicContentRouter | `/api/v1/public`         |
| adminContentRouter  | `/api/v1/admin/content`  |

## Files to read

### Routes

- [content.routes.ts](content.routes.ts)
- [legacy-blogs.routes.ts](legacy-blogs.routes.ts)
- [legacy-pages.routes.ts](legacy-pages.routes.ts)

### Controllers

- [content.controller.ts](content.controller.ts)
- [legacy-blogs.controller.ts](legacy-blogs.controller.ts)
- [legacy-pages.controller.ts](legacy-pages.controller.ts)

### Validation

- [content.validation.ts](content.validation.ts)
- [legacy-blogs.validation.ts](legacy-blogs.validation.ts)
- [legacy-pages.validation.ts](legacy-pages.validation.ts)

### Middleware

- [content.middleware.ts](content.middleware.ts)

### Services and domain helpers

- [services/article-content.ts](services/article-content.ts)
- [services/blog-posts.service.ts](services/blog-posts.service.ts)
- [services/blog-taxonomy.service.ts](services/blog-taxonomy.service.ts)
- [services/content-support.service.ts](services/content-support.service.ts)
- [services/legacy-blogs.service.ts](services/legacy-blogs.service.ts)
- [services/legacy-pages.service.ts](services/legacy-pages.service.ts)
- [services/page-access.service.ts](services/page-access.service.ts)
- [services/site-pages.service.ts](services/site-pages.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router              | Method | Relative path                   | Controller               |
| ------------------- | ------ | ------------------------------- | ------------------------ |
| publicContentRouter | GET    | `/blog/categories`              | listPublicBlogCategories |
| publicContentRouter | GET    | `/blog`                         | listPublicBlogPosts      |
| publicContentRouter | GET    | `/blog/:slug`                   | getPublicBlogPost        |
| adminContentRouter  | GET    | `/blog`                         | listAdminBlogPosts       |
| adminContentRouter  | POST   | `/blog`                         | createBlogPost           |
| adminContentRouter  | PUT    | `/blog/:id`                     | updateBlogPost           |
| adminContentRouter  | GET    | `/blog/:id`                     | getAdminBlogPost         |
| adminContentRouter  | DELETE | `/blog/:id`                     | deleteBlogPost           |
| adminContentRouter  | POST   | `/blog/:id/${action}`           | changeBlogPostState      |
| adminContentRouter  | GET    | `/blog-taxonomy/${path}`        | listBlogTaxonomy         |
| adminContentRouter  | POST   | `/blog-taxonomy/${path}`        | createBlogTaxonomy       |
| adminContentRouter  | PUT    | `/blog-taxonomy/${path}/:id`    | updateBlogTaxonomy       |
| adminContentRouter  | DELETE | `/blog-taxonomy/${path}/:id`    | deleteBlogTaxonomy       |
| publicContentRouter | GET    | `/pages`                        | listPublicPages          |
| publicContentRouter | GET    | `/pages/:slug`                  | getPublicPage            |
| adminContentRouter  | GET    | `/pages`                        | listAdminPages           |
| adminContentRouter  | POST   | `/pages`                        | createPage               |
| adminContentRouter  | PUT    | `/pages/:id`                    | updatePage               |
| adminContentRouter  | DELETE | `/pages/:id`                    | deletePage               |
| legacyBlogsRouter   | GET    | `/`                             | list                     |
| legacyBlogsRouter   | GET    | `/create`                       | editor                   |
| legacyBlogsRouter   | POST   | `/`                             | mutate                   |
| legacyBlogsRouter   | GET    | `/:blog/edit`                   | editor                   |
| legacyBlogsRouter   | GET    | `/:blog/preview`                | editor                   |
| legacyBlogsRouter   | PUT    | `/:blog`                        | mutate                   |
| legacyBlogsRouter   | DELETE | `/:blog`                        | mutate                   |
| legacyBlogsRouter   | POST   | `/:blog/${action}`              | mutate                   |
| legacyPagesRouter   | GET    | `/`                             | list                     |
| legacyPagesRouter   | GET    | `/list-data`                    | list                     |
| legacyPagesRouter   | GET    | `/:pageIdOrUid/get-update-data` | edit                     |
| legacyPagesRouter   | POST   | `/add-process`                  | create                   |
| legacyPagesRouter   | POST   | `/update-process`               | update                   |
| legacyPagesRouter   | POST   | `/:pageIdOrUid/delete-process`  | remove                   |

## Behavior tests

- [content.test.ts](../../../tests/content.test.ts)
- [knowledge.test.ts](../../../tests/knowledge.test.ts)
- [legacy-blogs.test.ts](../../../tests/legacy-blogs.test.ts)
- [legacy-pages.test.ts](../../../tests/legacy-pages.test.ts)
- [site-settings.test.ts](../../../tests/site-settings.test.ts)
- [translations.test.ts](../../../tests/translations.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
