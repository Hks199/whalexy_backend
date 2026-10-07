import Joi from 'joi';
import { mediaUrlSchema } from '../messaging/services/media-message.js';

const phone = Joi.string().pattern(/^[+()\d .-]{9,40}$/);
const name = Joi.string().trim().min(1).max(150);
const invoiceNumber = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9_-]{1,100}$/);
const amount = Joi.string().pattern(/^\d{1,9}(?:\.\d{1,4})?$/);
export const legacyTallyInvoiceBodySchema = Joi.object({
  phone_number: phone,
  customer_mobile: phone,
  party_mobile: phone,
  mobile: phone,
  customer_name: name,
  party_name: name,
  party: name,
  invoice_number: invoiceNumber,
  voucher_number: invoiceNumber,
  invoice_no: invoiceNumber,
  invoice_amount: amount,
  amount,
  total_amount: amount,
  invoice_date: Joi.string().pattern(/^(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/),
  date: Joi.string().pattern(/^(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/),
  company_name: name,
  currency: Joi.string()
    .pattern(/^[A-Z]{3}$/)
    .default('INR'),
  pdf_url: mediaUrlSchema,
  template_name: Joi.string()
    .pattern(/^[a-z0-9_]{1,512}$/)
    .default('tally_sales_invoice'),
  template_language: Joi.string().pattern(/^[A-Za-z]{2,3}(?:_[A-Za-z]{2,4})?$/),
  from_phone_number_id: Joi.string().pattern(/^\d{5,100}$/),
})
  .oxor('phone_number', 'customer_mobile', 'party_mobile', 'mobile')
  .or('phone_number', 'customer_mobile', 'party_mobile', 'mobile')
  .oxor('customer_name', 'party_name', 'party')
  .oxor('invoice_number', 'voucher_number', 'invoice_no')
  .or('invoice_number', 'voucher_number', 'invoice_no')
  .oxor('invoice_amount', 'amount', 'total_amount')
  .oxor('invoice_date', 'date');
