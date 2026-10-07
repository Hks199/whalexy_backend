# catalogs

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router         | Mounted prefix                       |
| -------------- | ------------------------------------ |
| catalogsRouter | `/api/v1/vendors/:vendorId/catalogs` |

## Files to read

### Routes

- [catalogs.routes.ts](catalogs.routes.ts)

### Controllers

- [catalogs.controller.ts](catalogs.controller.ts)

### Validation

- [catalogs.validation.ts](catalogs.validation.ts)

### Services and domain helpers

- [services/catalog-connections.service.ts](services/catalog-connections.service.ts)
- [services/catalog-content.ts](services/catalog-content.ts)
- [services/catalog-messaging.service.ts](services/catalog-messaging.service.ts)
- [services/catalog-products.service.ts](services/catalog-products.service.ts)
- [services/catalogs-support.service.ts](services/catalogs-support.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router         | Method | Relative path                             | Controller            |
| -------------- | ------ | ----------------------------------------- | --------------------- |
| catalogsRouter | GET    | `/`                                       | listCatalogs          |
| catalogsRouter | POST   | `/connect`                                | connectCatalog        |
| catalogsRouter | POST   | `/:catalogId/sync`                        | syncCatalog           |
| catalogsRouter | GET    | `/:catalogId/products`                    | listCatalogProducts   |
| catalogsRouter | POST   | `/:catalogId/products`                    | createCatalogProduct  |
| catalogsRouter | PUT    | `/:catalogId/products/:productId`         | updateCatalogProduct  |
| catalogsRouter | POST   | `/:catalogId/products/:productId/publish` | publishCatalogProduct |
| catalogsRouter | DELETE | `/:catalogId/connection`                  | disconnectCatalog     |

## Behavior tests

- [bot-catalogs.test.ts](../../../tests/bot-catalogs.test.ts)
- [catalogs.test.ts](../../../tests/catalogs.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
