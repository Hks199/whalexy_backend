import type { JWTPayload } from 'jose';

export interface Identity {
  userId: number;
  sessionId: string;
  vendorId?: number;
  permissions: string[];
  role?: string;
  apiKeyId?: string;
  apiPermissions?: string[];
  claims?: JWTPayload;
}
declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
      rawBody?: Buffer;
    }
  }
}
export {};
