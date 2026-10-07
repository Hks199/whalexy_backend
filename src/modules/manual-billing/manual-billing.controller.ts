import { type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { buildManualInvoice } from './services/manual-invoices.service.js';
import type { RequestHandler } from 'express';
import { serviceContext, sendResult } from '../../http/service-adapter.js';
import {
  prepareReceiptDownload as prepareReceiptDownloadService,
  getManualInvoice as getManualInvoiceService,
} from './services/manual-invoices.service.js';
import {
  listManualSubscriptions as listManualSubscriptionsService,
  quoteManualSubscription as quoteManualSubscriptionService,
  getManualSubscription as getManualSubscriptionService,
  submitManualPayment as submitManualPaymentService,
  cancelManualPayment as cancelManualPaymentService,
} from './services/manual-subscriptions.service.js';

export async function downloadPaymentReceipt(req: Request, res: Response) {
  const file = await prepareReceiptDownloadService(serviceContext(req, res));
  res.set('Content-Security-Policy', "default-src 'none'; sandbox").type(file.mimeType);
  res.download(file.target, file.filename, (error) => {
    if (error && res.headersSent) res.destroy();
    else if (error)
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Payment receipt file not found' } });
  });
}
export const listManualSubscriptions: RequestHandler = async (req, res) => {
  sendResult(res, await listManualSubscriptionsService(serviceContext(req, res)));
};
export const quoteManualSubscription: RequestHandler = async (req, res) => {
  sendResult(res, await quoteManualSubscriptionService(serviceContext(req, res)));
};
export const getManualSubscription: RequestHandler = async (req, res) => {
  sendResult(res, await getManualSubscriptionService(serviceContext(req, res)));
};
export const submitManualPayment: RequestHandler = async (req, res) => {
  sendResult(res, await submitManualPaymentService(serviceContext(req, res)));
};
export const cancelManualPayment: RequestHandler = async (req, res) => {
  sendResult(res, await cancelManualPaymentService(serviceContext(req, res)));
};
export const getManualInvoice: RequestHandler = async (req, res) => {
  sendResult(res, await getManualInvoiceService(serviceContext(req, res)));
};
export const downloadManualInvoice: RequestHandler = async (req, res) => {
  const value = await buildManualInvoice(req.identity!.vendorId!, Number(req.params.id)),
    pdf = new PDFDocument({ size: 'A4', margin: 50 });
  res
    .type('application/pdf')
    .set(
      'Content-Disposition',
      `attachment; filename="manual-invoice-${value.subscriptionId}.pdf"`,
    );
  pdf.on('error', () => res.destroy());
  pdf.pipe(res);
  pdf.fontSize(20).text('Payment invoice').moveDown();
  pdf
    .fontSize(11)
    .text(value.id)
    .text(value.businessName)
    .text(value.title)
    .text(
      `Paid: ${new Prisma.Decimal(value.amountMinor).div(new Prisma.Decimal(10).pow(value.minorDigits)).toFixed(value.minorDigits)} ${value.currency}`,
    )
    .text(`Payment method: ${value.paymentMethod}`)
    .text(`Reference: ${value.transactionReference}`)
    .text(`Issued: ${value.issuedAt}`)
    .text(`Period: ${value.periodStartsAt} to ${value.periodEndsAt}`)
    .text(`Carry-forward: ${value.creditMinor} minor units / ${value.creditDays} days`);
  pdf.end();
};
