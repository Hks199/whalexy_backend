# translations

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                   | Mounted prefix                  |
| ------------------------ | ------------------------------- |
| legacyTranslationsRouter | `/central-console/translations` |
| publicTranslationsRouter | `/api/v1/public/translations`   |
| adminTranslationsRouter  | `/api/v1/admin/translations`    |

## Files to read

### Routes

- [legacy-translations.routes.ts](legacy-translations.routes.ts)
- [translations.routes.ts](translations.routes.ts)

### Controllers

- [legacy-translations.controller.ts](legacy-translations.controller.ts)
- [translations.controller.ts](translations.controller.ts)

### Validation

- [legacy-translations.validation.ts](legacy-translations.validation.ts)
- [translations.validation.ts](translations.validation.ts)

### Middleware

- [translations.middleware.ts](translations.middleware.ts)

### Services and domain helpers

- [services/legacy-translations.service.ts](services/legacy-translations.service.ts)
- [services/translation-access.service.ts](services/translation-access.service.ts)
- [services/translations.ts](services/translations.ts)
- [translations.service.ts](translations.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                   | Method | Relative path                          | Controller             |
| ------------------------ | ------ | -------------------------------------- | ---------------------- |
| legacyTranslationsRouter | GET    | `/`                                    | languages              |
| legacyTranslationsRouter | GET    | `/language/:languageId`                | messages               |
| legacyTranslationsRouter | POST   | `/process-language-store`              | create                 |
| legacyTranslationsRouter | POST   | `/process-language-update`             | update                 |
| legacyTranslationsRouter | POST   | `/:languageId/process-language-delete` | remove                 |
| legacyTranslationsRouter | POST   | `/update`                              | updateMessage          |
| publicTranslationsRouter | GET    | `/`                                    | listPublicLanguages    |
| publicTranslationsRouter | GET    | `/:locale`                             | getPublicLanguage      |
| adminTranslationsRouter  | GET    | `/`                                    | listAdminLanguages     |
| adminTranslationsRouter  | POST   | `/`                                    | createLanguage         |
| adminTranslationsRouter  | PATCH  | `/:locale`                             | updateLanguage         |
| adminTranslationsRouter  | DELETE | `/:locale`                             | deleteLanguage         |
| adminTranslationsRouter  | GET    | `/:locale/messages`                    | getLanguageMessages    |
| adminTranslationsRouter  | PUT    | `/:locale/messages`                    | updateLanguageMessages |
| adminTranslationsRouter  | POST   | `/:locale/import-po`                   | importLanguagePo       |
| adminTranslationsRouter  | GET    | `/:locale/export-po`                   | exportLanguagePo       |

## Behavior tests

- [legacy-translations.test.ts](../../../tests/legacy-translations.test.ts)
- [translations.test.ts](../../../tests/translations.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
