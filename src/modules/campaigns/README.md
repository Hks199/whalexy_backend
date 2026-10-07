# campaigns

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Route prefixes

| Router               | Mounted prefix                        |
| -------------------- | ------------------------------------- |
| legacyCampaignRouter | `/vendor-console/whatsapp/campaign`   |
| campaignsRouter      | `/api/v1/vendors/:vendorId/campaigns` |

## Files to read

### Routes

- [campaigns.routes.ts](campaigns.routes.ts)
- [legacy-campaign.routes.ts](legacy-campaign.routes.ts)

### Controllers

- [campaigns.controller.ts](campaigns.controller.ts)
- [legacy-campaign.controller.ts](legacy-campaign.controller.ts)

### Validation

- [campaigns.validation.ts](campaigns.validation.ts)
- [legacy-campaign.validation.ts](legacy-campaign.validation.ts)

### Middleware

- [campaigns.middleware.ts](campaigns.middleware.ts)

### Services and domain helpers

- [services/campaign-access.service.ts](services/campaign-access.service.ts)
- [services/campaign-deletion.service.ts](services/campaign-deletion.service.ts)
- [services/campaign-delivery.service.ts](services/campaign-delivery.service.ts)
- [services/campaign-lifecycle.service.ts](services/campaign-lifecycle.service.ts)
- [services/campaign-management.service.ts](services/campaign-management.service.ts)
- [services/campaign-reporting.service.ts](services/campaign-reporting.service.ts)
- [services/campaigns-support.service.ts](services/campaigns-support.service.ts)
- [services/legacy-campaign.service.ts](services/legacy-campaign.service.ts)

## Route declarations

Paths below are relative to the router’s mounted prefix. Templates containing `${...}` are expanded by loops in the route file.

| Router               | Method | Relative path                         | Controller             |
| -------------------- | ------ | ------------------------------------- | ---------------------- |
| campaignsRouter      | GET    | `/`                                   | listCampaigns          |
| campaignsRouter      | POST   | `/`                                   | createCampaign         |
| campaignsRouter      | POST   | `/:id/cancel`                         | cancelCampaign         |
| campaignsRouter      | POST   | `/:id/pause`                          | pauseCampaign          |
| campaignsRouter      | POST   | `/:id/resume`                         | resumeCampaign         |
| campaignsRouter      | POST   | `/:id/duplicate`                      | duplicateCampaign      |
| campaignsRouter      | GET    | `/:id/status`                         | getCampaignStatus      |
| campaignsRouter      | POST   | `/:id/test`                           | sendCampaignTest       |
| campaignsRouter      | POST   | `/:id/archive`                        | archiveCampaign        |
| campaignsRouter      | POST   | `/:id/unarchive`                      | restoreCampaign        |
| campaignsRouter      | GET    | `/:id/report`                         | getCampaignReport      |
| campaignsRouter      | GET    | `/:id/recipients`                     | listCampaignRecipients |
| campaignsRouter      | DELETE | `/:id`                                | deleteCampaign         |
| legacyCampaignRouter | GET    | `/status/:campaignUid/data`           | status                 |
| legacyCampaignRouter | GET    | `/:status/list-data`                  | list                   |
| legacyCampaignRouter | GET    | `/queue/:campaignUid`                 | queue                  |
| legacyCampaignRouter | GET    | `/executed/:campaignUid`              | executed               |
| legacyCampaignRouter | POST   | `/:campaignIdOrUid/duplicate`         | duplicate              |
| legacyCampaignRouter | POST   | `/:campaignIdOrUid/delete-process`    | remove                 |
| legacyCampaignRouter | POST   | `/:campaignIdOrUid/archive-process`   | archive                |
| legacyCampaignRouter | POST   | `/:campaignIdOrUid/unarchive-process` | restore                |

## Behavior tests

- [ad-attribution.test.ts](../../../tests/ad-attribution.test.ts)
- [ads-manager.test.ts](../../../tests/ads-manager.test.ts)
- [campaign-workflows.test.ts](../../../tests/campaign-workflows.test.ts)
- [integration.test.ts](../../../tests/integration.test.ts)
- [legacy-ads.test.ts](../../../tests/legacy-ads.test.ts)
- [legacy-campaign.test.ts](../../../tests/legacy-campaign.test.ts)

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
