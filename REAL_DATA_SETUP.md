# IRA Presence — Production Setup

This project uses Supabase as the source of truth.

## Accounts

Employees:
- ARUN
- AKASH
- JACOB
- SATISH
- ANTREENA

Admin:
- IRA

Employee sign-in uses the name entered by the employee; the application resolves the linked Supabase Auth account behind the scenes. Admin sign-in uses the fixed admin ID `APEXADMIN`, which maps to the IRA Auth account.

## Environment

Set in local development and Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never put a Supabase secret/service-role key in the browser.

## Attendance

Employee flow: Office/WFH → Check In → Start Break/Resume (optional) → Check Out.

Check-out stores the final working seconds for the same IST calendar date. The timer stops after checkout.

## Holidays

Admin publishes company holidays. Employees see the same records in the Holidays section and in My Attendance. Holidays are never treated as absences.

## Mobile

Employee and Admin portals have dedicated responsive layouts. Desktop sidebars are hidden on mobile; tables convert to readable mobile cards.
