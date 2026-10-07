import { ApiError } from '../../shared/api-error.js';
import { db } from '../../database/client.js';
import { decrypt } from '../../utils/crypto.js';
import { config } from '../../config/environment.js';

export async function providerRequest(url: URL, init: RequestInit = {}, timeout = 15000) {
  const mutation = !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(
      502,
      'PROVIDER_UNCERTAIN',
      'Provider request did not complete; reconcile before repeating side effects',
    );
  }
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2000000) {
          await reader.cancel();
          throw new ApiError(
            502,
            mutation ? 'PROVIDER_UNCERTAIN' : 'PROVIDER_RESPONSE',
            'Provider response exceeded the allowed size',
          );
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      'PROVIDER_UNCERTAIN',
      'Provider response was interrupted; reconcile before repeating side effects',
    );
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!response.ok)
    throw new ApiError(
      502,
      mutation && response.status >= 500 ? 'PROVIDER_UNCERTAIN' : 'PROVIDER_REJECTED',
      `Provider rejected the request (HTTP ${response.status})`,
    );
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(
      502,
      mutation ? 'PROVIDER_UNCERTAIN' : 'PROVIDER_RESPONSE',
      'Invalid provider response',
    );
  }
}
export async function metaRequest(
  vendorId: number,
  provider: string,
  externalId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  query?: Record<string, string>,
) {
  const credential = await db.integrationCredentials.findUnique({
    where: { vendorId_provider_externalId: { vendorId, provider, externalId } },
  });
  if (!credential)
    throw new ApiError(503, 'INTEGRATION_NOT_CONFIGURED', 'Messaging account is not configured');
  const url = new URL(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${path}`);
  if (!/^[a-zA-Z0-9_/-]+$/.test(path))
    throw new ApiError(400, 'INVALID_PROVIDER_PATH', 'Invalid provider resource');
  if (query) for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return providerRequest(url, {
    method,
    headers: {
      Authorization: `Bearer ${decrypt(credential.secret)}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export async function twilioVerify(phone: string, code?: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID,
    secret = process.env.TWILIO_AUTH_TOKEN,
    service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !secret || !service)
    throw new ApiError(503, 'PHONE_VERIFICATION_NOT_CONFIGURED', 'Twilio Verify is not configured');
  const path = code ? 'VerificationCheck' : 'Verifications';
  return providerRequest(
    new URL(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`),
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(
        code ? { To: phone, Code: code } : { To: phone, Channel: 'sms' },
      ).toString(),
    },
  );
}
