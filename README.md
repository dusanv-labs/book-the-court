# BookTheCourt

A sports court booking system: players see free courts by the hour and book them online, and the venue owner manages courts, opening hours, pricing and bookings from an admin panel.

## Live demo

- **App:** https://dusanv-labs.github.io/book-the-court/
- **API docs (Swagger):** https://book-the-court-api.onrender.com/api/docs
- **Admin panel:** open *Admin* in the app and log in with `demo@example.com` / `court-demo-2026`

The demo database is reset every night, so feel free to book, cancel and change anything. The API runs on a free plan that sleeps when idle, so the first request can take up to a minute.

## Deployment

| Part | Where | How |
|---|---|---|
| Web app | GitHub Pages | `.github/workflows/deploy-web.yml` builds and deploys on every push to `main` |
| API | Render (free plan) | `render.yaml` Blueprint; deploys after CI passes |
| Database | Neon PostgreSQL | migrations and demo data applied by `.github/workflows/reset-demo.yml` (nightly) |

## Features

**Players**
- Three simple steps: sport → day → start time, with free start times shown as large buttons per court
- Filter by morning, afternoon or evening; a "next day" shortcut when a day is full
- Choose 60, 90 or 120 minutes with the price of each option shown upfront
- Booking code, private manage/cancel link and **Add to calendar** (.ics)
- Optional "remember my details" for faster repeat bookings
- English and Serbian, detected from the browser and switchable at any time

**Venue owner (admin)**
- Daily bookings with quick day switching, search (code, name, email, phone) and status filter
- New bookings for phone or walk-in customers, using the same booking flow
- Courts: rename, change sport or type, activate/deactivate
- Opening hours (with "copy Monday to all weekdays") and price rules with warnings for gaps and overlaps
- Block time on one or all courts, with a list of all upcoming blocks
- Styled confirmation dialogs and toast notifications instead of browser pop-ups

**Engineering highlights**
- Double booking prevented at the database level (PostgreSQL exclusion constraint)
- Slot availability and pricing logic covered by unit tests
- JWT authentication, request validation, OpenAPI (Swagger) docs
- CI on every push (lint, tests, build)

## Tech stack

| Part | Technologies |
|---|---|
| API (`api/`) | NestJS, TypeScript, Prisma, PostgreSQL, JWT, Swagger, Vitest |
| Web (`web/`) | React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Hook Form, Zod |
| Hosting | GitHub Pages (web), Render (API), Neon (PostgreSQL) |

## Running locally

Requirements: Node.js 22+ and a PostgreSQL database (for example a free [Neon](https://neon.tech) project).

```bash
npm install
cp api/.env.example api/.env        # then fill in DATABASE_URL, JWT_SECRET and the seed admin
npm run db:migrate -w api           # create tables and constraints
npm run build -w api
npm run db:seed -w api -- --demo    # demo courts, hours, prices, admin user, sample bookings
npm run dev:api                     # http://localhost:3000/api  (docs: /api/docs)
npm run dev:web                     # http://localhost:5173
```

Other scripts: `npm run lint`, `npm test` (unit), `npm run test:e2e` (against a real database), `npm run build`.

## API overview

Interactive OpenAPI docs are served at `/api/docs`.

| Area | Endpoints |
|---|---|
| Public | `GET /api/courts`, `GET /api/availability`, `GET /api/venue/hours`, `GET /api/venue/prices` |
| Booking | `GET /api/bookings/quote`, `POST /api/bookings`, `GET /api/bookings/manage/:token`, `POST /api/bookings/manage/:token/cancel` |
| Auth | `POST /api/auth/login` |
| Admin (JWT) | `/api/admin/courts`, `/api/admin/venue/hours`, `/api/admin/venue/prices`, `/api/admin/venue/blocks`, `/api/admin/bookings` |

## How double booking is prevented

1. The API checks availability before creating a booking (friendly error messages).
2. PostgreSQL enforces it with an exclusion constraint on `(court, time range)` for confirmed bookings, so even simultaneous requests cannot both succeed. An end-to-end test fires 8 parallel requests for the same slot and expects exactly one to succeed.

All times are stored in UTC; opening hours and prices are defined in the venue's local time (`Europe/Belgrade`), including daylight saving time changes.

## License

MIT
