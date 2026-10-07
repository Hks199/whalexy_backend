export type CommentEvent = {
  platform: 'facebook' | 'instagram';
  account: string;
  commentId: string;
  mediaId: string | null;
  commenterId: string | null;
  text: string;
  at: number;
  live: boolean;
};
export const socialId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
export const socialMessageId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\x00-\x20\x7f]/.test(v);
export function eventTime(v: unknown) {
  if (typeof v === 'string' && !/^\d+$/.test(v)) {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? (n < 100000000000 ? n * 1000 : n) : 0;
}
export function commentEvent(object: string, entry: any, change: any): CommentEvent | null {
  const platform = object === 'instagram' ? 'instagram' : object === 'page' ? 'facebook' : null,
    v = change.value;
  if (!platform || !v || typeof v !== 'object') return null;
  if (
    (platform === 'instagram' && !['comments', 'live_comments'].includes(change.field)) ||
    (platform === 'facebook' &&
      (change.field !== 'feed' || v.item !== 'comment' || (v.verb ?? 'add') !== 'add'))
  )
    return null;
  const account = String(entry.id ?? ''),
    commentId = v.comment_id ?? v.id,
    mediaId = v.media?.id ?? v.media_id ?? v.post_id ?? null,
    commenterId = v.from?.id ?? v.user_id ?? v.sender_id ?? null,
    text = v.text ?? v.message ?? '';
  if (
    !/^\d{5,100}$/.test(account) ||
    (v.recipient?.id && String(v.recipient.id) !== account) ||
    !socialId(commentId) ||
    (mediaId !== null && !socialId(mediaId)) ||
    (commenterId !== null && !socialId(commenterId)) ||
    typeof text !== 'string' ||
    text.length > 10000
  )
    return null;
  const at = eventTime(v.created_time ?? v.timestamp ?? entry.time);
  if (!at || at > Date.now() + 300000) return null;
  return {
    platform,
    account,
    commentId,
    mediaId,
    commenterId,
    text,
    at,
    live: change.field === 'live_comments',
  };
}
export function matchesComment(rule: any, event: CommentEvent) {
  if (
    rule.status !== 'active' ||
    rule.deletedAt ||
    rule.platform !== event.platform ||
    rule.externalAccountId !== event.account ||
    (rule.contentScope === 'specific' && (!rule.mediaId || rule.mediaId !== event.mediaId))
  )
    return false;
  if (rule.commentMatchType === 'any') return true;
  if (rule.commentMatchType !== 'keyword') return false;
  const normalize = (s: string) => s.trim().replace(/\s+/gu, ' ').toLowerCase(),
    text = normalize(event.text);
  if (!text) return false;
  return (
    Array.isArray(rule.keywords) &&
    rule.keywords.some((k: any) => {
      if (typeof k !== 'string') return false;
      const keyword = normalize(k);
      return (
        keyword &&
        (rule.matchOperator === 'equals'
          ? text === keyword
          : rule.matchOperator === 'starts_with'
            ? text.startsWith(keyword)
            : text.includes(keyword))
      );
    })
  );
}
