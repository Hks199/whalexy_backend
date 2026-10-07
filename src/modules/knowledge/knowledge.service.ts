import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { db } from '../../database/client.js';
import { config } from '../../config/environment.js';
import { ApiError } from '../../shared/api-error.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';
import { digest } from '../../utils/crypto.js';
import {
  aiServiceUrl,
  aiRequest,
  uploadAiKnowledge,
} from '../../infrastructure/providers/ai.client.js';
import { knowledgeRequestKeySchema } from './knowledge.validation.js';
import { validateKnowledgeWebsite } from './services/knowledge-website.service.js';

async function ingestKnowledge(
  input: ServiceContext,
  operation: 'upload' | 'website',
  hash: string,
  prepare: () => Promise<unknown>,
) {
  const vendorId = input.identity!.vendorId!;
  const { value, error } = knowledgeRequestKeySchema.validate(input.headers['idempotency-key']);
  if (error)
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'An 8–100 character Idempotency-Key is required',
    );
  const url = aiServiceUrl(vendorId, `knowledge/${operation}`);
  const key = `ai:knowledge:${operation}:${digest(value)}`;
  const requestHash = digest(
    JSON.stringify({ hash, url: url.href, credential: digest(config.WHALEXY_AI_API_KEY) }),
  );
  const previous = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${vendorId}:${key}`}))`;
    const prior = await tx.nativeIdempotency.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for different knowledge content',
        );
      return prior;
    }
    await tx.nativeIdempotency.create({ data: { vendorId, key, requestHash } });
    return null;
  });
  if (previous) {
    const saved = previous.response as { state?: string; body?: object; status?: number } | null;
    if (saved?.state === 'accepted')
      return serviceResult(saved.body, { status: saved.status!, format: 'json' });
    throw new ApiError(
      409,
      'KNOWLEDGE_RECONCILIATION_REQUIRED',
      'Knowledge ingestion is pending, rejected or uncertain; review the provider result before trying a new key',
    );
  }
  try {
    const response = await prepare();
    if (!response || typeof response !== 'object' || Array.isArray(response))
      throw new ApiError(502, 'PROVIDER_UNCERTAIN', 'Invalid knowledge ingestion acknowledgement');
    const provider = response as Record<string, unknown>;
    if (provider.success === false || provider.status === 'error')
      throw new ApiError(502, 'PROVIDER_REJECTED', 'Knowledge service rejected the ingestion');
    const body = { ...provider, success: true, status: 'success' };
    const status = operation === 'website' ? 202 : 200;
    await db.nativeIdempotency.update({
      where: { vendorId_key: { vendorId, key } },
      data: { response: { state: 'accepted', body: JSON.parse(JSON.stringify(body)), status } },
    });
    return serviceResult(body, { status, format: 'json' });
  } catch (error) {
    const state =
      error instanceof ApiError && (error.code === 'PROVIDER_REJECTED' || error.status < 500)
        ? 'rejected'
        : 'uncertain';
    // A durable claim remains even if storing an acknowledgement fails. Replays
    // cannot repeat an upload/crawl after a timeout or interrupted local commit.
    await db.nativeIdempotency
      .updateMany({ where: { vendorId, key }, data: { response: { state } } })
      .catch(() => undefined);
    throw error;
  }
}
export async function uploadKnowledgeDocument(input: ServiceContext) {
  const file = input.file;
  if (!file || !file.size || file.size > 10 * 1024 * 1024)
    throw new ApiError(422, 'FILE_REQUIRED', 'A PDF, TXT or DOCX file up to 10 MB is required');
  const filename = path
    .basename(file.originalname.replaceAll('\\', '/'))
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, 160);
  const extension = path.extname(filename).toLowerCase();
  const detected = await fileTypeFromBuffer(file.buffer);
  let mime: string;
  if (extension === '.txt' && !detected && !file.buffer.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new ApiError(422, 'INVALID_FILE', 'Text documents must contain UTF-8 text');
    }
    mime = 'text/plain';
  } else if (extension === '.pdf' && detected?.mime === 'application/pdf') mime = detected.mime;
  else if (
    extension === '.docx' &&
    detected?.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    mime = detected.mime;
  else
    throw new ApiError(
      422,
      'INVALID_FILE',
      'File content must match its PDF, TXT or DOCX extension',
    );
  return ingestKnowledge(
    input,
    'upload',
    digest(JSON.stringify({ content: digest(file.buffer), filename, mime })),
    () => uploadAiKnowledge(input.identity!.vendorId!, { buffer: file.buffer, filename, mime }),
  );
}
export async function addKnowledgeWebsite(input: ServiceContext) {
  const hash = digest(
    JSON.stringify({ websiteUrl: input.body.websiteUrl, title: input.body.title ?? null }),
  );
  return ingestKnowledge(input, 'website', hash, async () => {
    const websiteUrl = await validateKnowledgeWebsite(input.body.websiteUrl);
    return aiRequest(input.identity!.vendorId!, 'knowledge/website', 'POST', {
      website_url: websiteUrl,
      ...(input.body.title ? { title: input.body.title } : {}),
      category: 'general',
      language: 'en',
    });
  });
}
export async function listKnowledgeDocuments(input: ServiceContext) {
  const documents = await aiRequest(input.identity!.vendorId!, 'knowledge', 'GET');
  return serviceResult({ success: true, documents }, { status: 200, format: 'json' });
}
export async function deleteKnowledgeDocument(input: ServiceContext) {
  await aiRequest(input.identity!.vendorId!, `knowledge/${input.params.documentId}`, 'DELETE');
  return serviceResult(
    { success: true, message: 'Document deleted successfully.' },
    { status: 200, format: 'json' },
  );
}
