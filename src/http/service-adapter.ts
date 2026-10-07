import type { Request, Response } from 'express';
import type { ServiceContext, ServiceResult } from '../shared/service-context.js';

export function serviceContext(req: Request, res: Response): ServiceContext {
  return {
    identity: req.identity,
    body: req.body,
    params: req.params as Record<string, string>,
    query: req.query,
    headers: req.headers,
    validatedQuery: res.locals.query,
    metadata: { resource: res.locals.resource },
    id: req.id,
    rawBody: req.rawBody,
    file: req.file,
  };
}
export function sendResult(res: Response, result: ServiceResult | undefined): void {
  if (!result) return;
  if (result.headers) res.set(result.headers);
  if (result.contentType) res.type(result.contentType);
  res.status(result.status);
  if (result.format === 'empty') res.sendStatus(result.status);
  else if (result.format === 'end') res.end();
  else if (result.format === 'json') res.json(result.body);
  else res.send(result.body);
}
