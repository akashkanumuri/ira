# IRA Presence

Production-oriented Vite + React + Supabase attendance application.

## Run locally

```bash
npm install
npm run dev
```

Configure `.env.local` with:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Portals

- Employee: `/login`
- Admin: `/admin/login`

## Employee actions

Office/WFH selection → Check In → Break/Resume → Check Out.

## Admin

Attendance, employees, WFH requests, leave requests, corrections, holidays, and monthly Excel export.
