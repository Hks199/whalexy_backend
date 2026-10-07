import type { Identity } from '../types/http.js';

/** Plain application input. Services never receive Express requests or responses. */
export interface ServiceContext {
  identity?: Identity;
  body: any;
  params: Record<string, any>;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  validatedQuery?: any;
  id?: unknown;
  metadata?: any;
  rawBody?: Buffer;
  file?: {
    buffer: Buffer;
    size: number;
    originalname: string;
    mimetype: string;
  };
}
/** Preserve existing endpoint envelopes without coupling services to Express. */
export interface ServiceResult {
  body: unknown;
  status: number;
  format: 'json' | 'send' | 'empty' | 'end';
  headers?: Record<string, string>;
  contentType?: string;
}
export function serviceResult(body: unknown, options: Omit<ServiceResult, 'body'>): ServiceResult {
  return { body, ...options };
}
