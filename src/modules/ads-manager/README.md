# ads-manager

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router           | Mounted prefix                          |
| ---------------- | --------------------------------------- |
| legacyAdsRouter  | `/api/:vendorUid/ads-manager`           |
| adsManagerRouter | `/api/v1/vendors/:vendorId/ads-manager` |

## Files to read

### Routes

- [ads-manager.routes.ts](ads-manager.routes.ts)
- [legacy-ads.routes.ts](legacy-ads.routes.ts)

### Controllers

- [ads-manager.controller.ts](ads-manager.controller.ts)
- [legacy-ads.controller.ts](legacy-ads.controller.ts)

### Validation

- [ads-manager.validation.ts](ads-manager.validation.ts)
- [legacy-ads.validation.ts](legacy-ads.validation.ts)

### Middleware

- [ads-manager.middleware.ts](ads-manager.middleware.ts)

### Services and domain helpers

- [services/ad-accounts.service.ts](services/ad-accounts.service.ts)
- [services/ad-attribution.ts](services/ad-attribution.ts)
- [services/ad-insights.ts](services/ad-insights.ts)
- [services/ad-reporting.service.ts](services/ad-reporting.service.ts)
- [services/ad-structure.ts](services/ad-structure.ts)
- [services/ad-synchronization.service.ts](services/ad-synchronization.service.ts)
- [services/ads-manager-support.service.ts](services/ads-manager-support.service.ts)
- [services/legacy-ads.service.ts](services/legacy-ads.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router           | Method | Relative path                  | Controller               |
| ---------------- | ------ | ------------------------------ | ------------------------ |
| adsManagerRouter | GET    | `/accounts`                    | listAdAccounts           |
| adsManagerRouter | POST   | `/accounts/connect`            | connectAdAccount         |
| adsManagerRouter | POST   | `/accounts/:id/structure/sync` | syncAdStructure          |
| adsManagerRouter | POST   | `/accounts/:id/sync`           | syncAdInsights           |
| adsManagerRouter | DELETE | `/accounts/:id`                | disconnectAdAccount      |
| adsManagerRouter | GET    | `/campaigns`                   | listAdCampaigns          |
| adsManagerRouter | POST   | `/campaigns/:id/status`        | updateAdCampaignStatus   |
| adsManagerRouter | GET    | `/dashboard`                   | getAdDashboard           |
| adsManagerRouter | GET    | `/reports/export.csv`          | exportAdReport           |
| adsManagerRouter | POST   | `/conversions`                 | recordAdConversion       |
| adsManagerRouter | GET    | `/contacts/:id/attributions`   | getContactAdAttributions |
| legacyAdsRouter  | GET    | `/dashboard`                   | dashboard                |
| legacyAdsRouter  | GET    | `/campaigns`                   | campaigns                |
| legacyAdsRouter  | POST   | `/campaigns`                   | createCampaign           |
| legacyAdsRouter  | POST   | `/campaigns/:campaign/action`  | action                   |
| legacyAdsRouter  | POST   | `/conversions`                 | conversion               |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [ads-manager.test.ts](../../../tests/ads-manager.test.ts)
- [legacy-ads.test.ts](../../../tests/legacy-ads.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
