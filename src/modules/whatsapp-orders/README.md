# whatsapp-orders

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router                     | Mounted prefix                    |
| -------------------------- | --------------------------------- |
| legacyWhatsappOrdersRouter | `/vendor-console/whatsapp-orders` |

## Files to read

### Routes

- [whatsapp-orders.routes.ts](whatsapp-orders.routes.ts)

### Controllers

- [whatsapp-orders.controller.ts](whatsapp-orders.controller.ts)

### Validation

- [whatsapp-orders.validation.ts](whatsapp-orders.validation.ts)

### Services and domain helpers

- [services/order-export.service.ts](services/order-export.service.ts)
- [services/order-status.service.ts](services/order-status.service.ts)
- [services/order-support.service.ts](services/order-support.service.ts)
- [services/whatsapp-orders.service.ts](services/whatsapp-orders.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router                     | Method | Relative path       | Controller   |
| -------------------------- | ------ | ------------------- | ------------ |
| legacyWhatsappOrdersRouter | GET    | `/`                 | list         |
| legacyWhatsappOrdersRouter | GET    | `/data`             | list         |
| legacyWhatsappOrdersRouter | GET    | `/statistics`       | statistics   |
| legacyWhatsappOrdersRouter | GET    | `/export`           | exportOrders |
| legacyWhatsappOrdersRouter | PATCH  | `/:orderUid/status` | updateStatus |
| legacyWhatsappOrdersRouter | GET    | `/:orderUid`        | detail       |

## Behavior tests

- [legacy-whatsapp-orders.test.ts](../../../tests/legacy-whatsapp-orders.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
