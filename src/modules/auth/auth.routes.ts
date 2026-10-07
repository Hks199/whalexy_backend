import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import {
  registerBodySchema,
  resendVerificationBodySchema,
  loginBodySchema,
  refreshSessionBodySchema,
  verifyEmailBodySchema,
  requestPasswordResetBodySchema,
  startPhoneVerificationBodySchema,
  verifyPhoneBodySchema,
  resetPasswordBodySchema,
} from './auth.validation.js';
import * as controllers from './auth.controller.js';

export const authRouter = Router();
authRouter.post('/register', validate(registerBodySchema), controllers.register);
authRouter.post(
  '/resend-verification',
  validate(resendVerificationBodySchema),
  controllers.resendVerification,
);
authRouter.post('/login', validate(loginBodySchema), controllers.login);
authRouter.post('/refresh', validate(refreshSessionBodySchema), controllers.refreshSession);
authRouter.post('/logout', authenticate, controllers.logout);
authRouter.get('/me', authenticate, controllers.getCurrentUser);
authRouter.post('/verify-email', validate(verifyEmailBodySchema), controllers.verifyEmail);
authRouter.post(
  '/forgot-password',
  validate(requestPasswordResetBodySchema),
  controllers.requestPasswordReset,
);
authRouter.post(
  '/phone/start',
  validate(startPhoneVerificationBodySchema),
  controllers.startPhoneVerification,
);
authRouter.post('/phone/verify', validate(verifyPhoneBodySchema), controllers.verifyPhone);
authRouter.post('/reset-password', validate(resetPasswordBodySchema), controllers.resetPassword);
