import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ApiError } from '../../../shared/api-error.js';

export function isPublicKnowledgeAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    if (parsed.range() !== 'unicast') return false;
    const bytes = parsed.toByteArray();
    if (bytes.length === 4) return !(bytes[0] === 198 && (bytes[1] === 18 || bytes[1] === 19));
    // Restrict IPv6 to global unicast, excluding protocol-assignment prefixes.
    return (bytes[0]! & 0xe0) === 0x20 && !(bytes[0] === 0x20 && bytes[1] === 1 && bytes[2]! < 2);
  } catch {
    return false;
  }
}
export async function validateKnowledgeWebsite(value: string) {
  const url = new URL(value),
    host = url.hostname.toLowerCase();
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)
  )
    throw new ApiError(422, 'INVALID_WEBSITE', 'A public HTTP(S) website is required');
  let addresses;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), 5000);
        timer.unref();
      }),
    ]);
  } catch {
    throw new ApiError(422, 'INVALID_WEBSITE', 'Website host could not be resolved');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!addresses.length || addresses.some((record) => !isPublicKnowledgeAddress(record.address)))
    throw new ApiError(
      422,
      'INVALID_WEBSITE',
      'Website must resolve exclusively to public addresses',
    );
  // The remote crawler must also validate DNS and every redirect at fetch time.
  return url.href;
}
