import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';

export function contentSlug(value: string, fallback = 'article') {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 200) || fallback
  );
}
const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'img',
    'figure',
    'figcaption',
    'div',
    'span',
    'hr',
    'iframe',
  ],
  allowedAttributes: {
    '*': ['title'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    h2: ['id'],
    h3: ['id'],
    iframe: ['src', 'width', 'height', 'loading', 'allowfullscreen'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'] },
  allowProtocolRelative: false,
  nestingLimit: 100,
  allowedIframeHostnames: [
    'youtube.com',
    'www.youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
    'player.vimeo.com',
  ],
  allowIframeRelativeUrls: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      },
    }),
  },
};
export function prepareArticleContent(input: string) {
  const markdownCandidate = input.replace(/<\/?(?:p|div|br|li|blockquote|pre)\b[^>]*>/gi, '\n');
  // Decode text with the HTML parser; only text is retained for Markdown detection.
  let plain = '';
  // A wrapper makes frame.text available for fragments and decodes HTML entities.
  sanitizeHtml(`<div>${markdownCandidate}</div>`, {
    allowedTags: ['div'],
    allowedAttributes: {},
    exclusiveFilter: (frame) => {
      if (frame.tag === 'div') plain = frame.text;
      return false;
    },
  });
  let content = input;
  if (
    !/<h[2-6]\b/i.test(input) &&
    /(?:^|\n|\s)#{2,6}\s+\S|(?:^|\n)\|.+\|\n\|[-: |]+\|/m.test(plain)
  ) {
    content = marked.parse(plain, { async: false, gfm: true });
  }
  let html = sanitizeHtml(content, options);
  if (!/<h2\b/i.test(html) && /<h[34]\b/i.test(html)) {
    html = html.replace(
      /<(\/?)h([34])(\b[^>]*)>/gi,
      (_match, closing, level, rest) => `<${closing}h${level === '3' ? '2' : '3'}${rest}>`,
    );
  }
  const toc: {
    id: string;
    title: string;
    level: number;
  }[] = [];
  const used = new Set<string>();
  html = html.replace(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => {
    let title = '';
    sanitizeHtml(`<div>${body}</div>`, {
      allowedTags: ['div'],
      allowedAttributes: {},
      exclusiveFilter: (frame) => {
        if (frame.tag === 'div') title = frame.text.trim();
        return false;
      },
    });
    const base = contentSlug(title, 'section');
    let id = base,
      suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    toc.push({ id, title, level: Number(level) });
    return `<h${level} id="${id}">${body}</h${level}>`;
  });
  let text = '';
  sanitizeHtml(`<div>${html}</div>`, {
    allowedTags: ['div'],
    allowedAttributes: {},
    exclusiveFilter: (frame) => {
      if (frame.tag === 'div') text = frame.text;
      return false;
    },
  });
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { html: html.trim(), toc, readingTime: Math.max(1, Math.ceil(words / 220)) };
}
