# BookTheCourt

A sports court booking system: players see free courts by the hour and book them online, and the venue owner manages courts, opening hours, pricing and bookings from an admin panel.

> **Status:** in development. A live demo link will be added here.

## Planned features

**Players**
- Pick a sport and a day, then see a courts × hours availability grid
- Book a court for 60, 90 or 120 minutes with the price shown upfront
- Get a booking code and a cancellation link

**Venue owner (admin)**
- Manage courts (sport, indoor/outdoor) and opening hours
- Pricing rules: daytime, evening and weekend rates
- Block slots for maintenance or tournaments
- Daily bookings overview with cancellation

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

Requirements: Node.js 22+.

```bash
npm install
cp api/.env.example api/.env   # then fill in the values
npm run dev:api                # http://localhost:3000
npm run dev:web                # http://localhost:5173
```

Other scripts: `npm run lint`, `npm test`, `npm run build`.

## License

MIT
