# capabilities

This feature folder contains its routes and business workflows. Follow a route to its named controller, then the explicit service import in that controller.

## Files to read

### Controllers

- [capabilities.controller.ts](capabilities.controller.ts)

### Services and domain helpers

- [capabilities.service.ts](capabilities.service.ts)

This feature exposes application or background operations rather than its own HTTP router. Find its callers through the named exports in the service files.

Run `npm run docs:structure` after moving feature files or changing route declarations to refresh this guide.
