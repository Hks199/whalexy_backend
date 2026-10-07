import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  getAppointmentAvailability as getAppointmentAvailabilityService,
  createAppointmentResource as createAppointmentResourceService,
  holdAppointmentSlot as holdAppointmentSlotService,
} from './services/appointment-availability.service.js';
import {
  bookAppointment as bookAppointmentService,
  getAppointment as getAppointmentService,
  cancelAppointment as cancelAppointmentService,
  rescheduleAppointment as rescheduleAppointmentService,
  markAppointmentNoShow as markAppointmentNoShowService,
} from './services/appointment-bookings.service.js';

export const getAppointmentAvailability: RequestHandler = async (req, res) => {
  sendResult(res, await getAppointmentAvailabilityService(serviceContext(req, res)));
};
export const createAppointmentResource: RequestHandler = async (req, res) => {
  sendResult(res, await createAppointmentResourceService(serviceContext(req, res)));
};
export const holdAppointmentSlot: RequestHandler = async (req, res) => {
  sendResult(res, await holdAppointmentSlotService(serviceContext(req, res)));
};
export const bookAppointment: RequestHandler = async (req, res) => {
  sendResult(res, await bookAppointmentService(serviceContext(req, res)));
};
export const getAppointment: RequestHandler = async (req, res) => {
  sendResult(res, await getAppointmentService(serviceContext(req, res)));
};
export const cancelAppointment: RequestHandler = async (req, res) => {
  sendResult(res, await cancelAppointmentService(serviceContext(req, res)));
};
export const rescheduleAppointment: RequestHandler = async (req, res) => {
  sendResult(res, await rescheduleAppointmentService(serviceContext(req, res)));
};
export const markAppointmentNoShow: RequestHandler = async (req, res) => {
  sendResult(res, await markAppointmentNoShowService(serviceContext(req, res)));
};
