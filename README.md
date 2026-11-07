# FoodZone

Full-stack fast-food e-commerce app.

**Stack:** Next.js 16 (App Router, JavaScript) · Tailwind CSS v4 · PostgreSQL via Prisma 7 · recharts · react-toastify · lucide-react

## Getting started

1. Create a database on [neon.tech](https://neon.tech) and copy its pooled connection string.
2. Fill in `.env`:
   ```
   DATABASE_URL="postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/foodzone?sslmode=require"
   JWT_SECRET="a-long-random-secret"
   ```
3. Install dependencies and set up the database:
   ```bash
   npm install
   npm run db:migrate   # creates tables from prisma/schema.prisma
   npm run db:seed      # permissions, roles, chart of accounts, fiscal year
   ```
   The seed creates **no users and no sample data** — it is safe to run on any
   environment, including production, and converges when run again.
4. Turn on the repository's git hooks (once per clone):
   ```bash
   git config core.hooksPath .githooks
   ```
   `.githooks/pre-commit` regenerates `src/generated/openapi.json` when a route
   changes and adds it to the commit. The document is generated from the route
   modules — including their doc comments, which become the endpoint
   descriptions — so editing a comment changes it, which is easy to miss and
   fails CI's `docs:api:check`.
5. Run the dev server:
   ```bash
   npm run dev
   ```
6. Open **http://localhost:3000/setup** to create the owner account and the
   first branch. The page needs `SETUP_TOKEN` set in `.env`, and closes itself
   for good once an owner exists. `npm run db:bootstrap` does the same from a
   terminal — see **[docs/MODULES.md](docs/MODULES.md)**.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build & start
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — seed the permission catalogue, system roles, chart of accounts and the current fiscal year (no users, no sample data)
- `npm run db:bootstrap` — create the owner account and first branch from the command line
- `npm run db:demo` — fill the system with a demo restaurant: catalog with photographs, a month of orders, and a posted ledger (never in production)
- `npm run test:unit` / `npm run test:unit:coverage` — unit suite, with or without coverage
- `npm run test:e2e:ci` — every end-to-end suite, against a running server
- `npm run docs:api:check` — regenerate the OpenAPI document and fail if it differs from the committed copy
- `npm run db:studio` — open Prisma Studio

## Architecture

One backend serves the website **and** the future React Native app — there is no
separate Node service. See **[docs/API.md](docs/API.md)** for the client contract.

```
src/app/api/v1/*      Route handlers — validate input, call a service, return
src/server/services/  Business logic. The single source of truth.
src/server/validation Zod schemas shared by every route
src/lib/api/          Response envelope, error codes, tokens, session transport
src/lib/api-client.js Browser client (reference implementation for mobile)
src/proxy.js          CORS for non-browser / cross-origin clients
```

The rule that keeps the two clients from drifting: **business logic lives in
`src/server/services/`**, never in a route handler or a React Server Component.
Server Components import those services directly; the API routes wrap the same
functions. Both paths run identical code.

Auth works over two transports at once — `Authorization: Bearer` for mobile,
httpOnly cookies for the browser — with 15-minute access tokens and rotating
30-day refresh tokens stored hashed in the database so they can be revoked.

## Project structure

- `src/app` — pages + `api/v1/*` route handlers
- `src/components` — layout, product, and cart UI components
- `src/store/useCartStore.js` — Zustand cart store (persisted to localStorage)
- `src/lib/prisma.js` — Prisma client (uses the `@prisma/adapter-pg` driver adapter, required by Prisma 7)
- `src/app/globals.css` — design tokens (semantic color roles, type scale, elevation)
- `prisma/schema.prisma` — data model (User, RefreshToken, Address, Category, Product, Order, OrderItem)
- `prisma/seed.js` — sample fast-food menu data

## Notes

- Pages that query the database (`/`, `/menu`, `/orders`) are marked `export const dynamic = "force-dynamic"` so they aren't statically prerendered at build time.
- Prisma 7 requires a driver adapter — `@prisma/adapter-pg` is used here, which works with Neon's standard Postgres connection string.
- Theming: light is the default; set `data-theme="dark"` on `<html>` to switch. Components use semantic roles (`bg-surface`, `text-on-surface`) and need no `dark:` variants.
