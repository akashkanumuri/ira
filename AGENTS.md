# IRA Presence

React + Vite + Tailwind CSS employee attendance application.

## Development

Run `npm install` and `npm run dev` for local development.

## Project Structure

- `src/main.tsx` - React entrypoint
- `src/App.tsx` - Application shell and portal routing
- `src/index.css` - Tailwind v4 and responsive global styles
- `src/lib/attendance.ts` - real-time attendance engine
- `src/contexts/AuthContext.tsx` - Supabase Auth and portal separation
- `supabase/schema.sql` - database schema

## Production rules

- Supabase is the source of truth.
- No demo authentication or mock attendance data.
- Employee login: Name + Password.
- Admin login: APEXADMIN + password.
- Employee flow: Office/WFH -> Check In -> Break/Resume -> Check Out.
- Location/GPS/geofence features are not part of V1.
- Employee and Admin both have responsive mobile layouts.
