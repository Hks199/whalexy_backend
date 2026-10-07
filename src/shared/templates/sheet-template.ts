import { ApiError } from '../api-error.js';
import { publicMediaUrl } from '../../modules/messaging/services/media-message.js';

export type SheetMapping = {
  bodyColumns: number[];
  headerColumns: number[];
  mediaColumn?: number;
  filenameColumn?: number;
  buttonColumns: Record<string, number>;
  copyCodeColumn?: number;
};
function invalid(message: string): never {
  throw new ApiError(400, 'SHEET_TEMPLATE_MAPPING', message);
}
function slots(text: unknown) {
  const matches = [...String(text ?? '').matchAll(/\{\{([^{}]+)\}\}/g)],
    keys = [...new Set(matches.map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (keys.length > 20 || keys.some((n, i) => n !== i + 1))
    invalid('Template variables must be contiguous numbered parameters');
  return keys.length;
}
export function sheetTemplateSchema(data: any) {
  const components = data?.components ?? data?.template?.components;
  if (!Array.isArray(components) || !components.length)
    invalid('Synchronize the approved template components first');
  let body = 0,
    header = 0,
    media: string | null = null,
    copy: number | null = null;
  const buttons: number[] = [],
    seen = new Set<string>();
  for (const c of components) {
    const type = String(c?.type ?? '').toUpperCase();
    if (seen.has(type)) invalid('Duplicate template components');
    seen.add(type);
    if (type === 'BODY') body = slots(c.text);
    else if (type === 'HEADER') {
      const format = String(c.format ?? 'TEXT').toUpperCase();
      if (format === 'TEXT') {
        header = slots(c.text);
        if (header > 1) invalid('Text headers support one variable');
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) media = format.toLowerCase();
      else invalid('Unsupported header format');
    } else if (type === 'BUTTONS') {
      if (!Array.isArray(c.buttons) || c.buttons.length > 10) invalid('Invalid buttons');
      for (const [i, b] of c.buttons.entries()) {
        const kind = String(b.type).toUpperCase();
        if (kind === 'URL') {
          const n = slots(b.url);
          if (n > 1) invalid('URL buttons support one variable');
          if (n) buttons.push(i);
        } else if (kind === 'COPY_CODE') {
          if (copy !== null) invalid('Only one coupon button is supported');
          copy = i;
        } else if (!['QUICK_REPLY', 'PHONE_NUMBER'].includes(kind))
          invalid('Unsupported template button');
      }
    } else if (type !== 'FOOTER') invalid('Unsupported template component');
  }
  return { body, header, media, buttons, copy };
}
export function validateSheetMapping(data: any, map: SheetMapping) {
  const s = sheetTemplateSchema(data);
  if (map.bodyColumns.length !== s.body || map.headerColumns.length !== s.header)
    invalid('Map every body and header variable');
  if (s.media ? map.mediaColumn === undefined : map.mediaColumn !== undefined)
    invalid('Map only the required media header');
  if (s.media === 'document' ? map.filenameColumn === undefined : map.filenameColumn !== undefined)
    invalid('Map a filename only for document headers');
  if (s.copy !== null ? map.copyCodeColumn === undefined : map.copyCodeColumn !== undefined)
    invalid('Map only the required coupon code');
  if (
    JSON.stringify(
      Object.keys(map.buttonColumns)
        .map(Number)
        .sort((a, b) => a - b),
    ) !== JSON.stringify(s.buttons)
  )
    invalid('Map every dynamic URL button exactly once');
  return s;
}
export function sheetTemplateComponents(data: any, map: SheetMapping, row: string[]) {
  const s = validateSheetMapping(data, map),
    value = (column: number, max = 1024) => {
      const text = row[column]?.trim();
      if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text))
        invalid('Mapped row values must be nonempty text without controls');
      return text;
    },
    components: any[] = [];
  if (s.media) {
    const link = value(map.mediaColumn!, 2048);
    if (!publicMediaUrl(link)) invalid('Header media requires a public HTTPS URL');
    let filename: string | undefined;
    if (s.media === 'document') {
      filename = value(map.filenameColumn!, 240);
      if (/[\\/]/.test(filename) || ['.', '..'].includes(filename))
        invalid('Invalid document filename');
    }
    components.push({
      type: 'header',
      parameters: [{ type: s.media, [s.media]: { link, ...(filename ? { filename } : {}) } }],
    });
  } else if (s.header)
    components.push({
      type: 'header',
      parameters: map.headerColumns.map((c) => ({ type: 'text', text: value(c) })),
    });
  if (s.body)
    components.push({
      type: 'body',
      parameters: map.bodyColumns.map((c) => ({ type: 'text', text: value(c) })),
    });
  for (const i of s.buttons)
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(i),
      parameters: [{ type: 'text', text: value(map.buttonColumns[String(i)]) }],
    });
  if (s.copy !== null)
    components.push({
      type: 'button',
      sub_type: 'copy_code',
      index: String(s.copy),
      parameters: [{ type: 'coupon_code', coupon_code: value(map.copyCodeColumn!, 15) }],
    });
  return components;
}
