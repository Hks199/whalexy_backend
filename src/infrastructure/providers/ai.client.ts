import { ApiError } from '../../shared/api-error.js';
import { config } from '../../config/environment.js';
import { providerRequest } from './meta.client.js';

export function aiServiceUrl(vendorId: number, suffix: string) {
  if (!config.WHALEXY_AI_SERVICE_URL || !config.WHALEXY_AI_API_KEY)
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI service is not configured');
  const url = new URL(`/v1/vendors/${vendorId}/${suffix}`, config.WHALEXY_AI_SERVICE_URL);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        config.NODE_ENV !== 'production' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      ))
  )
    throw new ApiError(503, 'INSECURE_AI_SERVICE', 'AI service requires HTTPS');
  return url;
}
export async function aiRequest(vendorId: number, suffix: string, method = 'POST', body?: unknown) {
  return providerRequest(
    aiServiceUrl(vendorId, suffix),
    {
      method,
      headers: {
        'X-Internal-API-Key': config.WHALEXY_AI_API_KEY,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    45000,
  );
}
export async function uploadAiKnowledge(
  vendorId: number,
  file: { buffer: Buffer; filename: string; mime: string },
) {
  const url = aiServiceUrl(vendorId, 'knowledge/upload');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.filename);
  form.append('title', file.filename);
  form.append('category', 'general');
  form.append('language', 'en');
  return providerRequest(
    url,
    { method: 'POST', headers: { 'X-Internal-API-Key': config.WHALEXY_AI_API_KEY }, body: form },
    60000,
  );
}
