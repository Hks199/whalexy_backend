import {
  createContactGroupSchema,
  updateContactGroupSchema,
} from '../contact-workflows/contact-groups.validation.js';
import {
  createContactLabelSchema,
  updateContactLabelSchema,
} from '../contact-workflows/contact-labels.validation.js';
import { ApiError } from '../../shared/api-error.js';
import { can } from '../../shared/access-policy.js';
import { validate } from '../../middleware/validation.js';
import { resources, modelFields, schemaFor } from './resources.service.js';
import type { RequestHandler } from 'express';

export const authorizeResourceAccess: RequestHandler = async (req, res, next) => {
  const spec = resources[String(req.params.resource)];
  if (!spec) throw new ApiError(404, 'NOT_FOUND', 'Unknown resource');
  if (!can(req, spec.read)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (spec.model === 'AdConversationAttributions' && !can(req, 'vendor.contacts.view'))
    throw new ApiError(403, 'FORBIDDEN', 'Contact visibility permission required');
  if (!modelFields(spec.model).some((f) => f.name === 'vendorId'))
    throw new ApiError(503, 'UNVERIFIED_SCOPE', 'Business scope has not been verified');
  // Generic data endpoints cannot bypass assigned-chat restrictions.
  if (
    !can(req, 'vendor.chats.view_all') &&
    modelFields(spec.model).some((f) =>
      ['contactId', 'conversationId', 'contactUid'].includes(f.name),
    )
  )
    throw new ApiError(403, 'FORBIDDEN', 'Use the assigned-conversation endpoint');
  if (spec.model === 'WhatsappCalls' && !can(req, 'vendor.chats.view_all'))
    throw new ApiError(403, 'FORBIDDEN', 'Call history requires full chat visibility');
  res.locals.resource = spec;
  next();
};
export const validateResourceCreation: RequestHandler = async (req, res, next) => {
  const spec = res.locals.resource;
  if (!spec.write || !can(req, spec.write))
    throw new ApiError(403, 'FORBIDDEN', 'Resource is read-only or permission denied');
  validate(
    spec.model === 'Labels'
      ? createContactLabelSchema
      : spec.model === 'ContactGroups'
        ? createContactGroupSchema
        : schemaFor(spec.model),
  )(req, res, next);
};
export const validateResourceUpdate: RequestHandler = async (req, res, next) => {
  const spec = res.locals.resource;
  if (!spec.write || !can(req, spec.write))
    throw new ApiError(403, 'FORBIDDEN', 'Resource is read-only or permission denied');
  validate(
    spec.model === 'Labels'
      ? updateContactLabelSchema
      : spec.model === 'ContactGroups'
        ? updateContactGroupSchema
        : schemaFor(spec.model, true),
  )(req, res, next);
};
