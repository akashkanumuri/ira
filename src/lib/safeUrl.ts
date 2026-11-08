/**
 * Only web links may become clickable. Anything else (javascript:, data:, vbscript:, relative tricks)
 * returns undefined, so the link renders as plain text instead of running code.
 */
export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(String(raw).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
