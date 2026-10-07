import type { Identity } from '../types/http.js';

export interface AccessContext {
  identity?: Identity;
}
export function can(context: AccessContext, permission: string) {
  return (
    context.identity?.permissions.includes('*') ||
    context.identity?.permissions.includes(permission)
  );
}
