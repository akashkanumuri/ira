// Fails the build if anything secret-looking ends up in the browser bundle (dist/).
// The browser may only ever hold the Supabase URL, the publishable/anon key and public keys.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || 'dist';
const rules = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/sk_live_[A-Za-z0-9]{10,}/, 'Stripe live secret key'],
  [/sk_test_[A-Za-z0-9]{10,}/, 'Stripe test secret key'],
  [/rk_live_[A-Za-z0-9]{10,}/, 'Stripe restricted key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/, 'database connection string with password'],
  [/(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{20,}/, 'AI provider API key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
];

// A JWT whose payload says role=service_role.
const jwt = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html|css|json|map|txt|webmanifest)$/.test(n)) files.push(p);
  }
})(root);

const hits = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const [re, label] of rules) if (re.test(s)) hits.push(`${f}: ${label}`);
  for (const m of s.matchAll(jwt)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role && payload.role !== 'anon') hits.push(`${f}: JWT with role "${payload.role}"`);
    } catch { /* not a JWT */ }
  }
}

if (hits.length) {
  console.error('Secret-looking values found in the browser bundle:\n  ' + hits.join('\n  '));
  console.error('Move them to server-side environment variables (Edge Function secrets) and rotate them.');
  process.exit(1);
}
console.log(`Bundle secret check passed (${files.length} files scanned).`);
