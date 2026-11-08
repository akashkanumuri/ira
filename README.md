# IRA Presence

Production-oriented Vite + React + Supabase attendance application.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in your own values. See **Secrets & environment** below.

## Portals

- Employee: `/login`
- Admin: `/admin/login`

## Employee actions

Office/WFH selection → Check In → Break/Resume → Check Out.

## Admin

Attendance, employees, WFH requests, leave requests, corrections, holidays, and monthly Excel export.


## Secrets & environment

> **⚠️ Rotate any secret that was ever committed.** Removing a key from the code does not remove it from
> git history — anyone with a copy of the repository can still read old commits. If a secret (service-role
> key, database password, Stripe/OpenAI/Twilio key, JWT secret, VAPID private key…) is ever found in this
> repository's history, **rotate it immediately** in the provider's dashboard, then update the environment
> variable. A full history scan on 2026-11-08 found no secrets in any commit.

- **No secrets in source.** Every key, token, password and connection string comes from environment variables.
  `.env.example` lists them all with placeholders; `.env` and `.env.*` are git-ignored.
- **Browser variables (`VITE_*`) are public.** Vite bundles them into the JavaScript anyone can download. Only
  public-safe values go there: the Supabase URL, the Supabase **publishable** key (safe only because Row Level
  Security is enabled on every table), the VAPID **public** key and the push origin.
- **Server-only secrets** (the Supabase service-role key, the VAPID private key, any third-party API key) live
  only in Supabase Edge Function secrets (`supabase secrets set NAME=value`) or Supabase Vault — never in a
  `VITE_` variable, frontend code, logs or API responses.
- **Where they're set:** Vercel → Project → Settings → Environment Variables (browser values, production and
  preview); Supabase → Edge Functions → Secrets (server values).
