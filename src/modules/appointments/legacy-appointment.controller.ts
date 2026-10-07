import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import * as services from './services/legacy-appointment.service.js';
import * as bookings from './services/legacy-appointment-bookings.service.js';
import { ApiError } from '../../shared/api-error.js';
import type { ServiceContext, ServiceResult } from '../../shared/service-context.js';

function bookingHandler(
  operation: (input: ServiceContext) => Promise<ServiceResult>,
): RequestHandler {
  return async (req, res) => {
    try {
      sendResult(res, await operation(serviceContext(req, res)));
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['SLOT_UNAVAILABLE', 'OUTSIDE_SCHEDULE', 'INVALID_HOLD', 'BOOKING_DISABLED'].includes(
          error.code,
        )
      ) {
        res.status(409).json({ code: 'slot_unavailable', message: error.message });
        return;
      }
      throw error;
    }
  };
}
export const getLegacyAppointmentAvailability = bookingHandler(
  bookings.getLegacyAppointmentAvailability,
);
export const holdLegacyAppointmentSlot = bookingHandler(bookings.holdLegacyAppointmentSlot);
export const bookLegacyAppointment = bookingHandler(bookings.bookLegacyAppointment);
export const getLegacyAppointment = bookingHandler(bookings.getLegacyAppointment);
export const cancelLegacyAppointment = bookingHandler(bookings.cancelLegacyAppointment);

export const listLegacyAppointmentResources: RequestHandler = async (req, res) => {
  sendResult(res, await services.listLegacyAppointmentResources(serviceContext(req, res)));
};
export const createLegacyAppointmentResource: RequestHandler = async (req, res) => {
  sendResult(res, await services.createLegacyAppointmentResource(serviceContext(req, res)));
};
export const listLegacyAppointmentServices: RequestHandler = async (req, res) => {
  sendResult(res, await services.listLegacyAppointmentServices(serviceContext(req, res)));
};
export const createLegacyAppointmentService: RequestHandler = async (req, res) => {
  sendResult(res, await services.createLegacyAppointmentService(serviceContext(req, res)));
};
export const replaceLegacyAppointmentSchedule: RequestHandler = async (req, res) => {
  sendResult(res, await services.replaceLegacyAppointmentSchedule(serviceContext(req, res)));
};
