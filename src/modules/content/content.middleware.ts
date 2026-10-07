import { type RequestHandler } from 'express';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { validate as validateParams } from '../../middleware/validation.js';
import { blogPostParamsSchema } from './content.validation.js';

export const requireSiteAdministrator: RequestHandler = async (req, _res, next) => {
  const user = await db.users.findUnique({
    where: { id: req.identity!.userId },
    select: { userRolesId: true },
  });
  const allowed = req.path.startsWith('/blog') ? [1, 4] : [1];
  if (!user?.userRolesId || !allowed.includes(user.userRolesId))
    throw new ApiError(403, 'FORBIDDEN', 'Central content access denied');
  next();
};

export const validateBlogPostParams = validateParams(blogPostParamsSchema, 'params');
