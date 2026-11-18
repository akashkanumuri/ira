# SIGMA City — prototype

A living 3D island for SIGMA 1. Every building is a part of the product, and the weather shows how the company is doing.

> **Prototype.** All numbers on screen are sample data. Nothing here reads SIGMA records yet.

## What's on the island

| Place | SIGMA area | What it shows |
|---|---|---|
| Office towers | Work & tasks | Windows light up as people check in; vans carry work to the project sites |
| Bank | Payroll, billing & payments | A rainbow when a client payment arrives |
| School | Performance & growth | Bonus / PIP reviews waiting |
| Town hall | Admin & approvals | Its flag flies while approvals are waiting |
| Post office | Notifications | Unread count |
| Homes | Work from home & leave | A lit window = working from home today |
| Construction sites | Client projects | A floor per delivered deliverable; fireworks when complete; a storm when at risk |
| Harbour + ship | New clients | A ship sails in and docks when a contract is signed |
| Beach | Holidays | Next holiday on the sign |
| Mountain flag | Monthly goal | Climbs as the goal gets closer |
| Lighthouse | Security | Sweeps the bay at night |

The sky follows real Indian time (IST) — sunrise, day, sunset, night with stars — or pick a time at the top.
The **Try it** bar plays the live moments: check-ins, a deliverable done, a payment, a task going overdue, a new client, a fly-over.

## Run it

No build step and nothing to install — three.js (r160, MIT) is included in `vendor/`.

```bash
# from this folder, any static server works:
python3 -m http.server 8080
# then open http://localhost:8080
```

(Opening `index.html` straight from disk won't work: browsers block ES modules on `file://`.)

Deploy as a static site (Vercel, Netlify, GitHub Pages) with this folder as the root.

URL options: `?t=17.9` fixes the time of day (hours, IST); `?q=low` uses lighter graphics.

## Files

- `index.html` — page and overlay UI
- `src/main.js` — the scene: terrain, sky, sea, buildings, animations, labels, panels
- `src/styles.css` — overlay styling
- `vendor/three/` — three.js core + OrbitControls + Water (unmodified, MIT licence)
- `assets/waternormals.jpg` — water normal map from the three.js examples (MIT)

## Next steps (once the look is approved)

1. Embed as a **City** view inside SIGMA (lazy-loaded, so the rest of the app stays fast).
2. Replace sample numbers with SIGMA data through the existing, permission-checked database functions — each person only sees what they already can (clients: their own ship, site and bank).
3. Accessibility: a plain list view and a motion switch alongside the 3D view.
