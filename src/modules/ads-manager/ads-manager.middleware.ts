import { validate as validateParams } from '../../middleware/validation.js';
import { accountParamsSchema } from './ads-manager.validation.js';

export const validateAdAccountParams = validateParams(accountParamsSchema, 'params');
