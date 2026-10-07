import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  uploadMedia as uploadMediaService,
  prepareMediaDownload as prepareMediaDownloadService,
} from './media.service.js';

export const uploadMedia: RequestHandler = async (req, res) => {
  sendResult(res, await uploadMediaService(serviceContext(req, res)));
};
export const downloadMedia: RequestHandler = async (req, res) => {
  const file = await prepareMediaDownloadService(serviceContext(req, res));
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.download(file.target, file.filename);
};
