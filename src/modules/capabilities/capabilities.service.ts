import { resources } from '../resources/resources.service.js';

export function getCapabilities() {
  return {
    resources: Object.keys(resources),
    migrationStatus: 'in-progress',
    legacyCompatibility: false,
  };
}
