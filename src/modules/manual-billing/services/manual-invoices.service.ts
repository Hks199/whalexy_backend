import { db } from '../../../database/client.js';
import { ApiError } from '../../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../../shared/service-context.js';
import path from 'node:path';
import { uploadRoot } from '../../media/media.service.js';

export async function buildManualInvoice(vendorId: number, id: number) {
  const row = await db.manualSubscriptions.findFirst({ where: { id, vendorId } }),
    value = (row?.data as any)?.invoice;
  if (!value) throw new ApiError(404, 'NOT_FOUND', 'An approved native invoice was not found');
  return value;
}

export async function getManualInvoice(requestInput: ServiceContext) {
  return serviceResult(
    await buildManualInvoice(requestInput.identity!.vendorId!, Number(requestInput.params.id)),
    { status: 200, format: 'json' },
  );
}

export async function prepareReceiptDownload(requestInput: ServiceContext) {
  const vendorId = Number(requestInput.params.vendorId),
    id = Number(requestInput.params.id),
    row = await db.manualSubscriptions.findFirst({ where: { id, vendorId } }),
    receiptId = (row?.data as any)?.nativeManual?.receiptId;
  const file = receiptId
    ? await db.nativeMedia.findFirst({ where: { id: receiptId, vendorId } })
    : null;
  if (!file) throw new ApiError(404, 'NOT_FOUND', 'Payment receipt not found');
  const target = path.resolve(uploadRoot, file.path);
  if (!target.startsWith(uploadRoot + path.sep))
    throw new ApiError(404, 'NOT_FOUND', 'Payment receipt not found');
  return { target, mimeType: file.mimeType, filename: file.originalName || 'receipt' };
}
