import type { Request, RequestHandler, Response } from 'express';

/** Run a next-calling authentication/scope check inside one router layer. */
export function runMiddleware(handler: RequestHandler, req: Request, res: Response) {
  return new Promise<void>((resolve, reject) => {
    Promise.resolve(handler(req, res, (error) => (error ? reject(error) : resolve()))).catch(
      reject,
    );
  });
}
