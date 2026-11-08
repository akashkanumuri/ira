/**
 * The only way SIGMA writes to the browser console.
 *
 * Nothing personal ever reaches the console: emails, phone numbers, tokens, passwords and IDs are
 * replaced with "[REDACTED]", error objects are reduced to their code and message, and any other
 * object is reduced to the names of its fields (never their values). Debug output is off in production.
 */

const isProd = (() => {
  try { return Boolean(import.meta.env?.PROD); } catch { return true; }
})();

const PATTERNS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED]'], // JWTs / access tokens
  [/\b(?:sb_(?:secret|publishable)_|sk_|pk_|rk_)[A-Za-z0-9_-]{8,}/g, '[REDACTED]'], // API keys
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]'], // emails
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[REDACTED]'], // user / record IDs
  [/((?:password|passwd|pwd|token|secret|otp|apikey|api_key|authorization)\s*["'=:]+\s*)[^\s"',}]+/gi, '$1[REDACTED]'],
  [/(Key \([^)]*\)=\()[^)]*(\))/g, '$1[REDACTED]$2'], // Postgres "Key (email)=(…)" details
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  // Phone numbers and account numbers: any run with 10+ digits (dates and times stay readable).
  return out.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) || m.replace(/\D/g, '').length < 10 ? m : '[REDACTED]'));
}

function clean(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error || (typeof value === 'object' && value !== null && 'message' in value)) {
    const e = value as { name?: string; code?: string; status?: number; message?: unknown };
    const parts = [e.name && e.name !== 'Error' ? e.name : '', e.code ? `code ${e.code}` : '', e.status ? `status ${e.status}` : '']
      .filter(Boolean).join(', ');
    return `${parts ? `[${parts}] ` : ''}${redact(String(e.message ?? ''))}`;
  }
  if (typeof value === 'object') {
    // Never print values of arbitrary objects — only which fields were present.
    return `{${Object.keys(value as object).join(', ')}}`;
  }
  return '[REDACTED]';
}

const out = (fn: (...a: unknown[]) => void) => (...args: unknown[]) => {
  try { fn(...args.map(clean)); } catch { /* logging must never break the app */ }
};

export const log = {
  error: out(console.error.bind(console)),
  warn: out(console.warn.bind(console)),
  debug: isProd ? (() => undefined) as (...a: unknown[]) => void : out(console.debug.bind(console)),
};
