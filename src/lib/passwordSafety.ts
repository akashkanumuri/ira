/** Password rules shared by every screen that sets a password. Supabase enforces the same rules on its side. */
export const PASSWORD_RULES: [string, (p: string) => boolean][] = [
  ['12+ characters', (p) => p.length >= 12],
  ['uppercase', (p) => /[A-Z]/.test(p)],
  ['lowercase', (p) => /[a-z]/.test(p)],
  ['number', (p) => /\d/.test(p)],
  ['symbol', (p) => /[^A-Za-z0-9]/.test(p)],
];

export const isStrongPassword = (p: string) => PASSWORD_RULES.every(([, ok]) => ok(p));

/**
 * Have I Been Pwned "range" check (k-anonymity): only the first 5 characters of the password's SHA-1
 * hash leave the browser — never the password, never the full hash.
 */
export async function isLeakedPassword(password: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
  if (!res.ok) throw new Error('Password check is unavailable right now. Please try again.');
  return (await res.text()).split(/\r?\n/).some((l) => l.split(':', 1)[0].trim().toUpperCase() === hash.slice(5));
}
