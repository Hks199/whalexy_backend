import multer from 'multer';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import type { RequestHandler } from 'express';
import { validate as validateParams } from '../../middleware/validation.js';
import { paramsSchema } from './translations.validation.js';

export const translationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 1, fieldSize: 100, parts: 2 },
});

export const requireSiteAdministrator: RequestHandler = async (req, _res, next) => {
  const user = await db.users.findUnique({
    where: { id: req.identity!.userId },
    select: { userRolesId: true },
  });
  if (req.identity!.apiKeyId || user?.userRolesId !== 1)
    throw new ApiError(403, 'FORBIDDEN', 'Super administrator access required');
  next();
};

export const validateLocaleParams = validateParams(paramsSchema, 'params');
