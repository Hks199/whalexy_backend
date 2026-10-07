import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '../../database/client.js';
import { ApiError } from '../../shared/api-error.js';
import { config } from '../../config/environment.js';
import { aiRequest } from '../../infrastructure/providers/ai.client.js';
import { visibleContact } from '../contacts/contacts.service.js';
import { requestHandoff } from '../handoffs/services/handoffs.js';
import { serviceResult, type ServiceContext } from '../../shared/service-context.js';

export async function generateAiReply(requestInput: ServiceContext) {
  const c = await visibleContact(requestInput, requestInput.body.contactId);
  if (c.disableAiBot)
    throw new ApiError(409, 'AI_DISABLED', 'AI is disabled for this conversation');
  const vendorId = requestInput.identity!.vendorId!,
    traceId = randomUUID(),
    start = Date.now();
  await db.aiOperationTraces.create({
    data: {
      traceId,
      vendorId,
      operation: 'ai_bot_reply',
      provider: 'external',
      startedAt: new Date(),
    },
  });
  try {
    const result = await aiRequest(vendorId, 'chat', 'POST', {
      customer_phone: c.waId ?? String(c.id),
      message: requestInput.body.message,
      catalog: null,
    });
    const needsHuman = result.needs_human === true;
    if (needsHuman)
      await db.$transaction((tx) =>
        requestHandoff(tx, c, {
          reason: typeof result.reason === 'string' ? result.reason.slice(0, 100) : 'human_handoff',
          severity: 'high',
        }),
      );
    await db.aiOperationTraces.update({
      where: { traceId },
      data: { status: 'completed', finishedAt: new Date(), durationMs: Date.now() - start },
    });
    await db.vendorAiUsages.create({
      data: {
        vendorId,
        feature: 'ai_bot_reply',
        model: config.GROQ_MODEL,
        referenceId: String(c.id),
        promptTokens: Number.isSafeInteger(result.usage?.prompt_tokens)
          ? Math.max(0, result.usage.prompt_tokens)
          : 0,
        completionTokens: Number.isSafeInteger(result.usage?.completion_tokens)
          ? Math.max(0, result.usage.completion_tokens)
          : 0,
      },
    });
    return serviceResult(
      { reply: typeof result.reply === 'string' ? result.reply.slice(0, 16000) : null, needsHuman },
      { status: 200, format: 'json' },
    );
  } catch (e) {
    await db.aiOperationTraces.update({
      where: { traceId },
      data: {
        status: 'failed',
        errorType: e instanceof ApiError ? e.code : 'AI_ERROR',
        finishedAt: new Date(),
        durationMs: Date.now() - start,
      },
    });
    throw e;
  }
}
export async function listKnowledgeDocuments(requestInput: ServiceContext) {
  const result = await aiRequest(requestInput.identity!.vendorId!, 'knowledge', 'GET');
  return serviceResult(result, { status: 200, format: 'json' });
}
export async function deleteKnowledgeDocument(requestInput: ServiceContext) {
  await aiRequest(
    requestInput.identity!.vendorId!,
    `knowledge/${requestInput.params.id}`,
    'DELETE',
  );
  return serviceResult(undefined, { status: 204, format: 'end' });
}
export async function requestAiSupport(requestInput: ServiceContext) {
  if (!config.GROQ_API_KEY) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Groq is not configured');
  const folder = await mkdtemp(path.join(tmpdir(), 'whalexy-rag-')),
    input = path.join(folder, 'input.json'),
    output = path.join(folder, 'output.json');
  try {
    await writeFile(
      input,
      JSON.stringify({
        query: requestInput.body.query,
        history: requestInput.body.history,
        groq_api_key: config.GROQ_API_KEY,
        groq_model: config.GROQ_MODEL,
        request_timeout: 40,
        doc_path: path.resolve('python/whalexy_technical_documentation.md'),
      }),
      { mode: 0o600 },
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        config.PYTHON_BINARY,
        [path.resolve('python/whalexy_rag.py'), input, output],
        {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
          env: {
            PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
            TEMP: process.env.TEMP,
            PYTHONIOENCODING: 'utf-8',
          },
        },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new ApiError(504, 'AI_TIMEOUT', 'AI support request timed out'));
      }, 50000);
      child.on('error', () => {
        clearTimeout(timer);
        reject(new ApiError(503, 'PYTHON_UNAVAILABLE', 'Python execution is unavailable'));
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new ApiError(502, 'AI_UNAVAILABLE', 'AI support request failed'));
      });
    });
    const result = JSON.parse(await readFile(output, 'utf8'));
    if (result.error) throw new ApiError(502, 'AI_UNAVAILABLE', 'AI support request failed');
    return serviceResult(
      { reply: result.reply ?? result.answer ?? result.response ?? null },
      { status: 200, format: 'json' },
    );
  } finally {
    if (!path.resolve(folder).startsWith(path.resolve(tmpdir(), 'whalexy-rag-')))
      throw new Error('Unexpected temporary directory');
    await rm(folder, { recursive: true, force: true });
  }
}
