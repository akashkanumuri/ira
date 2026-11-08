// Server-side logging for Edge Functions. Nothing personal reaches the Supabase logs:
// emails, phone/account numbers, tokens, IDs and Postgres "Key (...)=(...)" details are replaced with [REDACTED],
// error objects are reduced to code + message, and other objects to their field names only.

const PATTERNS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED]'],
  [/\b(?:sb_(?:secret|publishable)_|sk_|pk_|rk_)[A-Za-z0-9_-]{8,}/g, '[REDACTED]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[REDACTED]'],
  [/((?:password|passwd|pwd|token|secret|otp|apikey|api_key|authorization)\s*["'=:]+\s*)[^\s"',}]+/gi, '$1[REDACTED]'],
  [/(Key \([^)]*\)=\()[^)]*(\))/g, '$1[REDACTED]$2'],
]

export function redact(text: string): string {
  let out = text
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep)
  return out.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) || m.replace(/\D/g, '').length < 10 ? m : '[REDACTED]'))
}

function clean(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') return redact(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const e = value as { code?: string; status?: number; statusCode?: number; message?: unknown }
    const tag = [e.code ? `code ${e.code}` : '', e.status || e.statusCode ? `status ${e.status ?? e.statusCode}` : ''].filter(Boolean).join(', ')
    return `${tag ? `[${tag}] ` : ''}${redact(String(e.message ?? ''))}`
  }
  if (typeof value === 'object') return `{${Object.keys(value as object).join(', ')}}`
  return '[REDACTED]'
}

export const logError = (...args: unknown[]) => console.error(...args.map(clean))
export const logWarn = (...args: unknown[]) => console.warn(...args.map(clean))
