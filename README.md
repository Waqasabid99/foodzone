# FoodZone

Full-stack fast-food e-commerce app.

**Stack:** Next.js 16 (App Router, JavaScript) · Tailwind CSS v4 · PostgreSQL (Neon) via Prisma 7 · Zustand · react-toastify · Framer Motion · lucide-react · react-icons

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
   npm run db:seed      # seeds sample categories/products
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build & start
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — seed sample data
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
