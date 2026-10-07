import { fileTypeFromBuffer } from 'file-type';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/environment.js';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { can } from '../../shared/access-policy.js';

export const allowed = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'audio/mpeg',
  'audio/ogg',
]);
export const uploadRoot = path.resolve(config.UPLOAD_DIR);
export async function uploadMedia(requestInput: ServiceContext) {
  if (!requestInput.file) throw new ApiError(400, 'FILE_REQUIRED', 'A file is required');
  const type = await fileTypeFromBuffer(requestInput.file.buffer);
  if (!type || !allowed.has(type.mime))
    throw new ApiError(400, 'INVALID_FILE', 'Unsupported file type');
  const vendorId = requestInput.identity!.vendorId!,
    filename = `${vendorId}/${randomUUID()}.${type.ext}`,
    target = path.join(uploadRoot, filename);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, requestInput.file.buffer, { mode: 0o600, flag: 'wx' });
  try {
    const record = await db.nativeMedia.create({
      data: {
        vendorId,
        ownerId: requestInput.identity!.userId,
        path: filename,
        mimeType: type.mime,
        size: requestInput.file.size,
        originalName: path
          .basename(requestInput.file.originalname)
          .replace(/[^a-zA-Z0-9_. -]/g, '')
          .slice(0, 160),
      },
    });
    return serviceResult(
      { id: record.id, mimeType: record.mimeType, size: record.size },
      { status: 201, format: 'json' },
    );
  } catch (e) {
    await unlink(target);
    throw e;
  }
}

export async function prepareMediaDownload(requestInput: ServiceContext) {
  const record = await db.nativeMedia.findFirst({
    where: { id: String(requestInput.params.id), vendorId: requestInput.identity!.vendorId! },
  });
  if (
    !record ||
    (!can(requestInput, 'vendor.chats.view_all') &&
      record.ownerId !== requestInput.identity!.userId)
  )
    throw new ApiError(404, 'NOT_FOUND', 'File not found');
  const target = path.resolve(uploadRoot, record.path);
  if (!target.startsWith(uploadRoot + path.sep))
    throw new ApiError(404, 'NOT_FOUND', 'File not found');
  return { target, mimeType: record.mimeType, filename: record.originalName || 'download' };
}
