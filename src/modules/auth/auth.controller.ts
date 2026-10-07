import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  register as registerService,
  resendVerification as resendVerificationService,
  login as loginService,
  refreshSession as refreshSessionService,
  logout as logoutService,
  getCurrentUser as getCurrentUserService,
  verifyEmail as verifyEmailService,
  requestPasswordReset as requestPasswordResetService,
  startPhoneVerification as startPhoneVerificationService,
  verifyPhone as verifyPhoneService,
  resetPassword as resetPasswordService,
} from './auth.service.js';

export const register: RequestHandler = async (req, res) => {
  sendResult(res, await registerService(serviceContext(req, res)));
};
export const resendVerification: RequestHandler = async (req, res) => {
  sendResult(res, await resendVerificationService(serviceContext(req, res)));
};
export const login: RequestHandler = async (req, res) => {
  sendResult(res, await loginService(serviceContext(req, res)));
};
export const refreshSession: RequestHandler = async (req, res) => {
  sendResult(res, await refreshSessionService(serviceContext(req, res)));
};
export const logout: RequestHandler = async (req, res) => {
  sendResult(res, await logoutService(serviceContext(req, res)));
};
export const getCurrentUser: RequestHandler = async (req, res) => {
  sendResult(res, await getCurrentUserService(serviceContext(req, res)));
};
export const verifyEmail: RequestHandler = async (req, res) => {
  sendResult(res, await verifyEmailService(serviceContext(req, res)));
};
export const requestPasswordReset: RequestHandler = async (req, res) => {
  sendResult(res, await requestPasswordResetService(serviceContext(req, res)));
};
export const startPhoneVerification: RequestHandler = async (req, res) => {
  sendResult(res, await startPhoneVerificationService(serviceContext(req, res)));
};
export const verifyPhone: RequestHandler = async (req, res) => {
  sendResult(res, await verifyPhoneService(serviceContext(req, res)));
};
export const resetPassword: RequestHandler = async (req, res) => {
  sendResult(res, await resetPasswordService(serviceContext(req, res)));
};
