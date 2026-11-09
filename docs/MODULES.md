# FoodZone — Build Plan

Every module the system needs, in dependency order. Tick items off as they land.

**Status key:** `[ ]` not started · `[~]` partially built, needs rework · `[x]` done

**Scope reminder:** backend only for now — schema, services, API endpoints. The
website and the React Native app both consume the same `/api/v1` endpoints, so
every module ships as API + service, never as page-specific logic.

**Conventions every module follows**
- Route handlers use `apiHandler` from `@/lib/api` and declare their own
  `permissions` — never rely on `proxy.js` for authorisation.
- Business logic lives in `src/server/services/*.service.js`; route handlers
  only parse, authorise and format.
- Anything touching money or stock runs inside `withTransaction`.
- Permission keys already exist in the seeded catalogue (294 of them). If a
  module needs a key that isn't there, add it to `prisma/seeds/permissions.js`
  and re-run the seed — never invent one at the call site.

**Running the tests**

```bash
npm run test:unit          # pure logic, no server or database writes

# the end-to-end suites drive a real server over HTTP
APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret \
  npx next dev -p 3100 > /tmp/foodzone-e2e-server.log 2>&1 &

npm run test:e2e           # all 22 phase suites in sequence
```

Four details are easy to trip over, and each one fails as a confusing
assertion rather than an obvious error:

- **`APP_URL` must match the port.** The local storage driver builds public URLs
  from it, so a mismatch serves files from a server that is not running.
- **`CRON_SECRET` must be set.** Without it the internal job endpoints
  deliberately run open in development, so Phase 2's "hidden without the secret"
  checks cannot pass. Use the same value the suite sends (`E2E_CRON_SECRET`,
  default `phase2-test-secret`). Note what the suites deliberately do *not*
  read: `CRON_SECRET` from `.env`. A test helper that falls back to it sends
  the real secret to a server started with the e2e one, and the drain returns
  401 — which surfaces as every ledger assertion after it failing, as though
  nothing posted.
- **Phase 1 reads emailed codes from the server's log**, because codes are
  hashed in the database. Redirect the server's output to the path above, or
  point `E2E_LOG` somewhere else.
- **Do not rebuild while a suite is running.** `next build` and `next dev` share
  the `.next` directory, so a build mid-run restarts the server underneath the
  tests and the suite dies partway through its cleanup.
- **Restart `next dev` after adding a dynamic route directory.** A new
  `[param]` folder created while the dev server is up is not always picked up,
  and the request comes back as an HTML 404 rather than an API error — which
  reads like a broken handler rather than a missing route.

Every suite cleans up after itself and fails if the database is not back to its
seeded baseline.

---

## Phase 0 — Foundation

- [x] **Database schema** — 137 models across 13 domain files in `prisma/schema/`
- [x] **Initial migration** — squashed to `20260908120000_init_full_schema`, applied
- [x] **RBAC seed** — 294 permissions, 20 system roles, idempotent
- [x] **API helper layer** — `apiHandler`, errors, validation, tokens, cookies,
      RBAC resolution, rate limiting, pagination, audit, logging, doc numbering
- [ ] **Bootstrap seed** — owner account + first branch, so the system can be used
- [x] **Test harness** — `npm test` (59 unit + 385 end-to-end), self-cleaning

---

## Phase 1 — Identity & Access

- [x] **Authentication** — register, login, refresh rotation with reuse detection, logout, logout-all
- [x] **Account verification** — emailed 6-digit codes, attempt caps, resend cooldown *(phone OTP deferred)*
- [x] **Password lifecycle** — forgot, reset, change, `tokensValidFrom` force-logout
- [x] **Sessions & devices** — list and revoke sessions, Expo push-token registry
- [x] **User management (admin)** — CRUD, suspend, reactivate, staff invitations
- [x] **Roles & permissions (admin)** — catalogue, create/edit roles, assign per
      branch, per-user allow/deny overrides, escalation guards
- [x] **Customer profile (self)** — profile read/update, address book CRUD
- [x] **Audit log** — query API with filters, distinct-action list

## Phase 2 — Platform & Branches

- [x] **Branches** — CRUD, opening hours (split shifts, overnight, per-channel), closures, live open state
- [x] **Settings** — typed registry, branch → global → default layering, public subset
- [x] **Media & uploads** — direct signed uploads + confirm, Cloudinary/S3-R2/local drivers, compression policy
- [x] **Notifications** — in-app feed, admin send by user or role, Expo push registry and dispatch
- [x] **Outbox worker** — SKIP LOCKED claiming, leases, backoff; in-process loop *and* cron endpoint

### Deferred from Phase 2

- [x] **Orphaned upload sweep** — `sweepOrphanedUploads` deletes objects uploaded
      but never confirmed, run from the job scheduler or `POST /admin/media/sweep`
- [ ] **SMS / WhatsApp channels** — provider not chosen yet
- [ ] **Notification preferences** — per-user, per-type opt-outs
- [ ] **Distributed rate-limit store** — needed before running several instances

## Phase 3 — Catalog & Menu

- [x] **Categories** — CRUD, 4-level tree with cycle and depth guards, bulk reorder
- [x] **Products & variants** — CRUD, images, dietary tags, station routing,
      auto default variant, generated SKUs, draft-by-default publishing, soft delete + restore
- [x] **Modifiers** — reusable groups, options, per-product overrides, rule satisfiability checks
- [x] **Combos** — combo groups and options, default-variant resolution, no self- or nested combos
- [x] **Menus** — per-branch menus by channel, sections, per-variant price overrides,
      scheduled time windows (overnight-safe), 86 switch with timed expiry
- [x] **Kitchen stations** — CRUD and product routing
- [x] **Public catalog API** — categories, products, product page, search, and the
      branch menu read model with schedule resolution

### Deferred from Phase 3

- [x] **Bulk import/export** — CSV round-trip for categories, products, variants
      and menu items, matched on natural keys so re-importing an export updates
      rather than duplicates; blank leaves a value alone and `--` clears it;
      validate-then-apply in one transaction, with `dryRun`; never deletes
- [x] **Menu cloning** — copy a menu with its sections and items to another
      branch or channel; the clone is inactive, is not the default, and does not
      inherit the source's 86 state
- [ ] **Full-text search** — `ILIKE` is fine at this size; revisit with `tsvector`
      or a search service once the catalog is large

## Phase 4 — Dine-in surface

- [x] **Tables** — CRUD per branch, areas, seats, bulk layout, per-branch unique names
- [x] **QR codes** — opaque permanent tokens, five target types, repointing,
      printable SVG/PNG, scan tracking, per-code and per-branch analytics
- [x] **Public QR menu** — `/qr/{code}` resolves a scan to a branch menu, table,
      category, product or redirect, with no auth and a stale-target fallback

### Deferred from Phase 4

- [x] **Table ordering** — a `DINE_IN` checkout takes a `tableId`, which is
      checked against the branch before the order is written, so a scan now
      orders rather than only viewing
- [ ] **Table state** — occupied/free, party size, server assignment *(needs orders)*
- [ ] **Batch print sheet** — a single PDF of every code for a branch, laid out
      for a sticker sheet

## Phase 5 — Ordering

- [x] **Cart** — server-side, guest carts by `x-session-id`, claimed and merged on
      login, full modifier/combo validation, repriced from the live menu on every read
- [x] **Pricing engine** — pure and Decimal-based: per-unit modifiers, inclusive and
      exclusive tax, compound rates, configurable fees, rounding with `roundOff`
- [x] **Checkout** — availability and branch guards, quote endpoint, one-transaction
      order creation, per-branch daily document numbering
- [x] **Order lifecycle** — a per-type state machine with guards, cancellation rules
      split between customer and staff, status history, narrow tracking endpoint
- [x] **Counter & table orders (POS)** — staff order entry through the same
      `placeOrder` as customer checkout
- [x] **Kitchen display (KDS)** — per-station queue, item status machine, ticket bump,
      auto-advance of the order, live summary
- [x] **Invoices** — issue with their own number series, void, replace, receipt payload
- [x] **Reviews** — purchase-verified, moderation queue, public summary with distribution

### Deferred from Phase 5

- [x] **Depletion at checkout** — the ledger landed in Phase 9 and
      `depleteForOrder` runs off the order event, with `reverseDepletion` on
      cancel. *Holding* stock for an unmade order was the other half and is
      done too — see Phase 9's **Stock reservation at checkout**
- [x] **Discounts at checkout** — delivered in Phase 6
- [x] **Editing a placed order** — `addCourse` and `removeOrderItem` add and
      remove lines after placement behind `orders.edit_items`, and re-run
      `syncOrderPaymentState` so a bill settled and then added to reads
      correctly
- [x] **Scheduled orders** — a customer picks a slot, not a minute. The grid comes
      from the branch's own trading hours, stops a full slot before closing, and
      holds a per-branch ceiling enforced at checkout rather than only drawn on
      the page. The kitchen board keeps a pre-order off the pass until there is
      time to cook it, and counts it separately until then
- [x] **Invoice PDF rendering** — rendered through pdfkit at
      `GET /admin/orders/{id}/invoice/pdf`

## Phase 6 — Pricing, Discounts & Tax

- [x] **Tax engine** — tax group and rate CRUD, inclusive vs exclusive, compound
      rates with a computed `effectiveRate`, per-line tax lines; rates that have
      been charged are immutable so filed invoices stay true
- [x] **Promotions** — a pure rules engine covering percentage, fixed, free
      delivery, free item, buy-x-get-y and bundle price, with product / variant
      / category targeting (exclusions beating inclusions), date, day, branch-
      timezone time window, branch, channel and order-type scheduling, and
      stacking resolved by "the customer gets the better deal"
- [x] **Coupons** — codes as keys onto promotions, case-insensitive, bulk
      generation under a revocable campaign tag, per-user and global limits
      enforced by the write rather than the read, redemption tracking
- [x] **Manual discounts** — separate permission, non-overridable percentage
      cap checked in aggregate, mandatory reason, synchronous audit naming the
      approver

### Deferred from Phase 6

- [ ] **Loyalty** — `OrderDiscountSource.LOYALTY` exists in the schema and the
      engine takes the resolved amount, but points, tiers and earn/burn rules
      are a programme of their own
- [ ] **Discount reporting** — "what did this campaign cost us" is answerable
      from `OrderDiscount` today, but the aggregate report lands with the rest
      of reporting in Phase 11
- [ ] **Promotion previews** — "who would this have applied to last week" needs
      a replay over historical orders
- [ ] **Per-region tax** — `TaxRate.region` is modelled and stored, but choosing
      a rate by the delivery address's jurisdiction is not wired up; every
      branch currently uses its products' groups as configured

## Phase 7 — Payments

Provider decision: **build the adapter, defer the acquirer.** The whole online
path is implemented and tested against a `mock` gateway, and a real provider is
one file implementing the interface. That avoids committing to an acquirer
before there are merchant credentials, and nothing downstream depends on which
one it turns out to be.

- [x] **Payment gateway integration** — provider adapter interface and registry,
      intent creation, capture, void, client-supplied idempotency keys, `cash`
      and `mock` providers
- [x] **Cash on delivery** — collection marking that lands the money in a
      register session and writes a cash movement
- [x] **Webhooks** — raw-body signature verification, store-then-process, `(provider,
      eventId)` idempotency, replay, unknown event types ignored rather than failed
- [x] **Refunds** — request/approve/reject lifecycle on separate permissions,
      partial refunds capped against in-flight ones, derived order state sync
- [x] **Cash registers** — open/close/reconcile, signed movements, expected cash
      derived from rows, blind count with variance
- [x] **Payment state** — a pure derivation from the payment and refund rows,
      never assigned by hand

### Deferred from Phase 7

- [x] **A real acquirer** — Safepay, implemented in
      `src/server/payments/providers/safepay.js`: hosted checkout, the
      `x-sfpy-signature` webhook, refunds with the gateway's own 90-day limit,
      and declared credentials. Nothing outside `providers/` changed, as
      predicted. A second gateway is another file, not another feature
- [x] **Store credit as tender** — built with Phase 13's wallet; see **Store
      credit as a tender at checkout** there for what it does
- [ ] **Driver cash-in-hand and handover** — COD collected by a driver is
      recorded against a session today; the driver-specific float, reconciliation
      and handover flow belong with drivers in Phase 8
- [x] **Prepayment enforcement** — `payments.require_prepayment_for` is read at
      checkout, which refuses an order of a listed type unless it is being paid
      now: a gateway chosen, or store credit already covering the whole bill.
      Staff-placed orders are exempt, like the minimum order amount, because
      the till is how a counter takes money. If the gateway then will not
      start, such an order is cancelled rather than left standing as "pay in
      person" — which would be the exact thing the setting prevents, quietly
- [ ] **Settlement reconciliation** — matching a provider's payout file against
      captured payments and fees; belongs with finance in Phase 11
- [ ] **Payment retries and dunning** — retrying a failed charge is possible
      manually; scheduled retry policy is not modelled

## Phase 8 — Delivery

- [x] **Drivers** — a `User` with a `Driver` record (one login, one reset flow),
      vehicle details, availability with guards, shifts that bring a driver on
      and off the board, cash-in-hand reconciled at shift end
- [x] **Dispatch** — one board call, manual assignment and reassignment,
      per-driver concurrency limits, jobs returned to the pool
- [x] **Delivery lifecycle** — a pure state machine, hashed single-use handover
      code, optional proof photo, failures with a mandatory reason, order status
      mirrored so the customer is never behind
- [x] **Live tracking** — last known position on `Driver` for the first paint,
      breadcrumbs sampled at ~30s on the active delivery, pruned on a retention
      schedule, and a public tracking endpoint that exposes a first name only
- [x] **Driver payouts** — period generation counting each drop exactly once,
      COD deducted, approve/pay/cancel lifecycle, audited

### Deferred from Phase 8

- [ ] **Auto-assignment** — the dispatch board and every guard assignment needs
      are in place; choosing *which* driver automatically wants distance
      (a routing provider) and a fairness policy, both decisions of their own
- [ ] **Batching** — `Delivery.sequence` is modelled and the driver queue is
      ordered by it, but grouping drops into a planned multi-stop run is not
      exposed yet
- [ ] **Realtime channel** — positions are pushed over HTTP and read back on
      poll. The schema comment is explicit that the live stream belongs in Redis
      or a socket channel; that is infrastructure, not modelling
- [ ] **Distance and ETA** — `distanceKm` and `estimatedMinutes` are stored and
      returned but nothing computes them; they need a routing provider
- [ ] **Driver ratings** — `ratingAverage` is on the model and `Review` already
      relates to a driver; surfacing a per-driver rating flow is its own feature
- [ ] **Proof of delivery** — not modelled. `Delivery` records
      `recipientName` and nothing else: there is no signature or photo column
      and no media link, so a disputed drop has only the driver's word and the
      status timestamps. *(This entry previously claimed `signatureUrl` was
      modelled. It never was.)*

## Phase 9 — Inventory & Procurement

- [x] **Units of measure** — one-hop conversion to a base unit, refused across
      measurement types, immutable once used
- [x] **Inventory items** — CRUD, categories, costing method, reorder policy,
      prep yield; deactivated rather than deleted, and never while stock remains
- [x] **Stock locations** — per-branch stores, kitchens, bars, one default
- [x] **Stock ledger** — `postMovement` is the single write path, `StockLevel`
      is a cache, and `rebuildLevels` replays the ledger to prove it
- [x] **Batches & expiry** — lot tracking, FIFO by expiry then receipt date,
      quarantine, write-off, an expiry report and a nightly expiry flag
- [x] **Suppliers** — CRUD, price lists, preferred supplier, lead times
- [x] **Purchase orders** — draft/approve/send/receive/close lifecycle, priced
      from the agreed list, moving no stock
- [x] **Goods receipts** — one-transaction posting, rejections excluded from
      stock, landed cost spread by line value, batches created with expiry
- [x] **Transfers** — two-step dispatch and receive with stock in transit, and
      shortfalls recorded as loss at the source
- [x] **Stock counts** — system quantity frozen at open, blind sheets, variance
      posted once as `COUNT_CORRECTION`
- [x] **Adjustments & wastage** — reason-coded; adjustments approval-gated,
      wastage posted immediately because the food is already in the bin
- [x] **Sale-time depletion** — recursive recipe explosion with sub-recipes,
      modifier ingredients, unit conversion and yield gross-up; idempotent per
      order and reversed on cancellation

### Deferred from Phase 9

- [x] **Stock reservation at checkout** — a placed order holds its ingredients
      through the same recipe explosion depletion uses later, `StockReservation`
      is the truth behind `reservedQuantity` the way `StockMovement` is the
      truth behind `quantity`, reserving *reconciles* so a second round moves
      the hold instead of stacking one on top, depletion consumes the hold in
      the same transaction as the `SALE_OUT`, cancellation releases it, and the
      nightly sweep catches orders that reached neither. `inventory.reservation`
      is `off`/`hold`/`enforce` per branch, defaulting to the one that cannot
      cost a sale; under `enforce` a conditional increment means the *write*
      decides the race for the last portion
- [x] **Supplier bills and AP** — built in Phase 11: a bill is raised from a
      receipt (`supplier-bills/from-receipt/:goodsReceiptId`), submitted,
      approved, paid against, and aged by `ageBalances`
- [x] **Journal postings** — the posting rules landed in Phase 11 and every
      movement type is wired through `posting.service` off its outbox event:
      COGS, stock asset, wastage and GRNI all post
- [ ] **Purchase requisitions** — an internal "we need this" step before a PO
      is not modelled
- [ ] **Batch-level valuation report** — valuation runs at average cost for
      speed; a lot-by-lot report is a separate read
- [ ] **Barcode scanning flows** — `barcode` is stored and searchable, but
      scan-to-receive and scan-to-count are client concerns
- [x] **Recipe management** — Phase 10 delivered all three: CRUD with a cycle
      guard, versioning (`revise`, `activate`, `versions`) and the costing
      roll-up (`cost`, `recost`, `menu-cost`)

## Phase 10 — Production

- [x] **Recipes (BOM)** — CRUD, nested sub-recipes, versioning, yield, cycle
      guard, unit validation at save time, one live version per output
- [x] **Recipe costing** — recursive roll-up from ingredient costs plus labour
      and overhead, `missingCosts` propagated up through sub-recipes, cached on
      the recipe and on the variant's `standardCost`, menu food-cost report
- [x] **Modifier ingredients** — CRUD and costing for add-ons, which depletion
      has read since Phase 9 but nothing could write
- [x] **Production orders** — plan, start (issues material), consume, complete
      (books output, credits by-products, writes off yield loss), cancel
      (reverses onto the original batches)
- [x] **Production variance** — cost and yield variance per run and per recipe

### Fixed while building Phase 10

- **Sub-recipe quantities were never converted into the sub-recipe's yield
      unit.** "150 ml of sauce" against a sauce recipe yielding 2 litres handed
      150 to the recursion instead of 0.15, exploding the sub-recipe a thousand
      times over. The explosion is now one shared module
      (`src/server/production/explode.js`) used by depletion, production
      planning and costing alike, so the three can no longer disagree.
- **Inbound movements against a named batch left the batch remainder behind.**
      `postMovement` now takes `restoreBatch`, used by production cancellation.
      Opt-in rather than inferred, because a goods receipt also posts inbound
      against a batch it created a moment earlier.

### Deferred from Phase 10

- [x] **Journal postings for production** — `postProductionRun` posts off
      `finance.production_completed`: the output is debited to inventory at
      what the run cost, the materials are credited out of it, labour and
      overhead are absorbed (credited, not charged twice) and yield loss is
      expensed to wastage. There is no WIP leg — a run is atomic here, so
      stock never sits in progress — which is why this entry's earlier
      description of one was wrong
- [ ] **Recipe allergens and nutrition** — modelled on the catalog side, but
      rolling them up through a recipe tree is its own piece of work
- [ ] **Production scheduling** — `scheduledFor` is stored and filterable, but
      capacity planning and a suggested-runs-from-forecast job are not built
- [ ] **Partial completion** — a run completes once. A batch produced across two
      shifts is two runs today
- [ ] **Recipe cost history** — only the current roll-up is cached; a
      cost-over-time series needs its own table

## Phase 11 — Finance

- [x] **Chart of accounts** — 37 seeded system accounts, CRUD, hierarchy,
      `GET /admin/accounts/verify` proves the chart still supports every rule
- [x] **Fiscal calendar** — years, generated monthly periods, close in order,
      reopen with a reason, one-way lock
- [x] **Journal engine** — balanced posting, period guard inside the
      transaction, reversal-only corrections, idempotency by source,
      `GET /admin/journal-entries/audit` re-checks debits equal credits
- [x] **Posting rules** — sale, COGS, payment, refund, goods receipt,
      production, wastage, stock adjustment, driver payout, cash variance,
      supplier bill, bill payment, expense
- [x] **Accounts payable** — bills from GRNs, approval, payments, ageing
- [x] **Expenses** — categories, recording, approval, summary by category
- [x] **Financial reports** — P&L, balance sheet, trial balance, cash flow,
      close pack with its own tie-out checks
- [~] **Operational reports** — sales, product mix, inventory and delivery are
      built; creator and HR reports wait on Phases 12 and 13

### Design notes

- **A sale debits receivable, never cash**, even for a cash order. The sale and
  the money are separate events that can happen in either order; the payment
  rule clears the receivable.
- **Tax-inclusive pricing is derived from the order's own figures**, not from
  the `ordering.prices_include_tax` setting. The setting is mutable — flipping
  it would silently re-post historical orders — while the document's arithmetic
  cannot change after the fact.
- **A goods receipt credits GRNI, not payables.** The delivery and the invoice
  are days apart, and crediting payables on arrival makes every unbilled
  delivery look like an approved invoice.
- **Discounts are contra-income, tips are a liability.** A discount is revenue
  never earned rather than a cost incurred; a tip belongs to the staff.
- **Postings run out of band, from the outbox.** The sale has happened and the
  stock has moved: refusing to record an operational fact because an account
  was missing would make the system less true. Every rule is idempotent on its
  source, and `POST /admin/journal-entries/backfill` fills any gap.

### Fixed while building Phase 11

- **`pg_advisory_xact_lock` through `$queryRaw` failed on every posting.** The
  function returns `void`, which Prisma cannot deserialize, so the idempotency
  lock threw and *no* business event reached the ledger. Now `$executeRaw`.
- **Three posting rules wrote the wrong entity's id into a foreign key.** The
  entry's foreign key was inferred from the source name, which is wrong for a
  bill payment (source id is the payment, the key is the bill), a refund (the
  column is `paymentId`) and COGS (whose source id is a synthetic
  `<orderId>:COGS`). Links are now passed explicitly by each rule.
- **A production entry double-counted labour and overhead.** They were debited
  *and* included in the output value the production module had already rolled
  them into, leaving the entry out of balance by exactly the conversion cost.
  Absorption credits them instead.
- **The P&L added contra-income to revenue instead of subtracting it.** Balances
  arrived signed in each account's own normal direction, so DEBIT-normal
  "Discounts given" read as +100 inside a credit-normal section. Statements now
  derive the sign from the section.

### Deferred from Phase 11

- [x] **Payroll postings** — built in Phase 12: approval posts the wage bill
      gross, payment clears the payable
- [x] **HR operational report** — built as the Attendance report
      (`/dashboard/reports/attendance`, gated on `reports.view_hr`)
- [ ] **Creator operational report** — still open; tracked under Phase 13's
      **Creator report**
- [ ] **Year-end close** — periods close and lock, but rolling income and
      expense into retained earnings and opening the next year is not built.
      The balance sheet carries current earnings into equity instead, which is
      correct to read but is not a posted closing entry
- [ ] **Multi-currency** — accounts and documents carry a currency, but there
      is no revaluation, no rate table and no gain/loss account
- [ ] **Accounts receivable ageing** — the sale rule creates receivables and
      `ageBalances` is shared, but an AR ageing report is not exposed; every
      order is paid at or near completion today
- [ ] **Budgets and forecasting** — not modelled
- [ ] **Tax filing returns** — tax payable accumulates correctly; producing a
      filing period return is its own piece of work

## Phase 12 — HR & Attendance

- [x] **Departments & employees** — CRUD, employment details, salary components,
      pay behind its own `employees.view_salary` / `manage_salary` permissions
- [x] **Shifts & rosters** — shift definitions with night shifts expressed as an
      end past 1440, per-date roster, weekly offs as roster rows
- [x] **Attendance devices** — registry, hashed API key shown once, sync cursor,
      health derived from silence
- [x] **Punch ingestion** — device push endpoint, de-duplication on
      `(device, deviceLogId)`, unmatched punches kept and claimable
- [x] **Attendance derivation** — folds punches into days, late/OT/half-day
      rules, manual correction with a reason, approval
- [x] **Leave** — types, quotas, balances with carry-forward, requests and
      approvals that re-derive the days they cover
- [x] **Holidays** — company-wide and per-branch calendars
- [x] **Payroll** — period generation from attendance, payslip lines showing
      their working, approval, payment marking, ledger posting

### Design notes

- **Punches are raw, append-only and never edited.** The terminal's record is
  evidence; a correction is a MANUAL punch added alongside and the day is
  re-derived. Every manual punch carries who added it.
- **An unknown biometric id is kept, not dropped.** Enrolment lags hiring, and
  discarding those punches loses attendance nobody can recover. They queue for
  HR and are claimed when the id is enrolled.
- **A missing punch-out is flagged, never guessed.** Assuming somebody left at
  their shift end pays unworked hours; assuming they never arrived steals worked
  ones. `MISSING_PUNCH` pays nothing until a human looks — the safe direction,
  because an under-payment gets reported by the person affected.
- **A manual correction survives re-derivation.** One that evaporates on the
  next nightly run is worse than none, because whoever made it believes it stuck.
- **Approving payroll locks the attendance it paid**, and only then — freezing
  at generation would block the corrections generation exists to pick up.
- **Payroll posts gross, not net.** Deductions are money withheld from a wage
  fully earned; posting net understates the cost of employing people by exactly
  the amount deducted.

### Operational note

Postings need the fiscal calendar. A system with no `FiscalYear` covering a
date accumulates business events that never reach the books, and
`POST /admin/journal-entries/backfill` cannot help until the year exists.

`npm run db:seed` therefore opens the year covering today, with one period per
month — **1 July to 30 June**, Pakistan's financial year. A client whose year
differs sets `FISCAL_YEAR_START_MONTH` (1-12) *before the first seed*; changing
it afterwards does not move years that already exist.

### Setting up a new installation

`db:seed` leaves a system with permissions, roles, a chart of accounts, a
fiscal calendar and public pages — and nobody who can sign in. Closing that gap
is the one action in the system that creates an administrator with no
administrator behind it, so it has its own guards.

Two ways in, both through `services/bootstrap.service.js`, so there is one
definition of a correctly set-up installation rather than two that drift:

**The `/setup` page.** On a fresh deployment the site serves a form asking for
the owner's name, email and password, and the first branch's code, name, city,
timezone and currency (defaulting to `Asia/Karachi` and `PKR`). Hand the link
to the client and they choose their own password, so nobody else ever knows it.

It is guarded three ways, each failing closed:

* only while **zero users exist** — any user at all means the system has been
  in use, and the page `notFound()`s rather than explaining itself;
* only with the **`SETUP_TOKEN`** from the environment, compared in constant
  time. An unset variable refuses everything, because a deployment where
  somebody forgot it is exactly the one worth protecting;
* rate limited, as the auth endpoints are.

A well-formed request with the wrong token and one made after setup is
complete both answer **404**, identically — an anonymous caller cannot learn
whether an installation is waiting to be claimed.

**`npm run db:bootstrap`.** The same work from a terminal, reading
`OWNER_NAME`, `OWNER_EMAIL`, `BRANCH_CODE`, `BRANCH_NAME` and optionally
`OWNER_PASSWORD`, `BRANCH_CITY`, `BRANCH_TIMEZONE`, `BRANCH_CURRENCY`. Leave
the password out and one is generated and printed once. No token is needed:
anyone who can run it already has the database credentials.

The owner is created with `isSuperAdmin`, which the permission layer documents
as "bootstrap account only" — that is this account. Staff should be given roles
instead.

### The demo restaurant

`npm run db:demo` fills an installation with a working Karachi fast-food chain,
so the system can be shown to somebody. It is the opposite of `db:seed` in
every way that matters: invented content, and it **refuses to run when
NODE_ENV is production**.

What it creates:

* an owner account (`owner@foodzone.demo` / `demo-owner-pass`) **first**, because
  setup refuses once any user exists and this script creates eight customers —
  seeding before bootstrapping locks you out of your own demo;
* two branches, 7 categories and 20 products with real photographs, 32 price
  variants, 4 shared modifier groups, a laid-out menu per branch, and 24 tables
  each with its own QR code;
* eight customers (`demo-customer-pass`) and a month of trading — around 570
  orders weighted to lunch and dinner peaks, busier at weekends and at the
  larger branch, spread across every channel and order type, with nine left
  mid-flight so the kitchen board and the pass are not empty;
* the ledger, posted through the **real posting rules** — so revenue, cost of
  sales, tax payable and the cash and card accounts are genuine double-entry
  and the trial balance balances because it is true.

Photographs are hot-linked from Unsplash, whose host is already allowed in
`next.config.mjs`, so nothing is committed and no storage driver has to be
configured before a demo looks right. Every URL was fetched and looked at
before it was used: a 200 proves a photograph exists, not that it is the right
one.

The catalog upserts, so editing `prisma/demo/menu.js` and re-running updates it
in place. The trading history does **not** — orders carry unique numbers and
posted ledger entries behind them, and regenerating would either collide or
double the revenue on screen. Re-running leaves the existing history alone; to
rebuild it, drop the database and seed again.

It also seeds the store room: 34 inventory items across six categories with
Karachi wholesale costs, four suppliers, a stock location per branch, and 17
costed recipes. Opening stock arrives as **posted goods receipts** rather than
rows written into a levels table — that is the only way the numbers downstream
are real, because the receipt is what moves the stock, sets each weighted
average cost, creates the batches the expiry report reads, and posts inventory
and GRNI to the ledger.

The payoff is the screen a restaurant owner leans in for: a Classic Beef
Burger costing Rs 249.90 in ingredients against Rs 690 on the menu, and
Rs 660,491 of stock on the shelf.

Ten employees with biometric ids and a terminal per branch come with it — see
*Testing attendance without a terminal* above.

Not yet seeded: purchase orders, expenses, and reviews. Those screens are
still empty.

### Backups, and proving they work

Two scripts, both needing `pg_dump` and `pg_restore` from `postgresql-client`.

`npm run db:backup` dumps in Postgres's custom format, **lists the dump it
just wrote**, copies it off the machine if `BACKUP_OFFSITE_CMD` is set, and
prunes old ones. The listing step is the one that matters: a dump that cannot
be read is not a backup, and the moment to find that out is now rather than
during an incident. The offsite command is yours — `rclone`, `aws s3 cp`,
`scp` — so this adds no dependency and assumes nothing about where copies
live. **A backup on the same disk as the database is not a backup**, and the
script says so on every run until the variable is set.

Retention keeps 14 days but never fewer than 3 dumps, whatever their age. A
machine switched off for a month comes back, prunes by age, and finds it has
deleted everything it had — which is how a retention policy becomes the thing
that loses the data. `server/ops/backup-policy.js` is pure and has tests,
because deleting backups is the only destructive part of the system.

`npm run db:restore-drill` restores the newest dump into a scratch database
and **asks the restored data questions only coherent data can answer**:

* every migration in the repository is present;
* the tables a restaurant would notice losing are populated;
* **the ledger balances** — debits equal credits to the rupee, which is false
  if rows were lost from the middle of a dump, where a row count would pass;
* the newest order is recent, and not dated in the future, which would mean
  the clocks disagree somewhere.

The scratch database is dropped afterwards unless `--keep` is passed. Run it
on an ordinary Tuesday, on purpose. Nobody discovers their backups are useless
while things are working.

### Knowing when something is wrong

`GET /api/health` is unauthenticated and outside `/api/v1`, because its callers
are uptime monitors, load balancers and deploy scripts, none of which have a
session. It reports the database, whether migrations ran, whether the queue is
moving, and how many postings are waiting for a fiscal year.

It returns **503 only when the database is unreachable**, and `degraded` with
a 200 when the site is serving customers but background work has stopped —
because that is real but not worth paging somebody at 3am. It deliberately
leaks nothing: no versions, no hostnames, no business counts, and no driver
error text, which carries hosts and user names.

Requests slower than `SLOW_REQUEST_MS` (default 1500) log a warning with the
method, path, status and request id. Not every request: a dinner service
produces thousands of fast ones and a log that is mostly "took 11ms" is a log
nobody reads. The query string is never logged — it carries search terms,
phone numbers and tokens.

### Testing attendance without a terminal

The device side of attendance needs a box on a wall, which makes it the one
part of the system that cannot be exercised by clicking around. It can still
be tested completely, because a terminal is only an HTTP client: it
authenticates with a device key, pushes a buffer of punches to
`POST /api/v1/devices/punches`, and replays that buffer when the network comes
back.

`scripts/attendance-terminal.mjs` is that client. It keeps a monotonic log id
per punch in a local state file the way a terminal keeps it in flash, holds
punches when a push fails instead of dropping them, and can run its clock fast
or slow:

```sh
node scripts/attendance-terminal.mjs --serial ZK-CLF-0001 --key dev_… --day
node scripts/attendance-terminal.mjs --serial ZK-CLF-0001 --key dev_… --replay
node scripts/attendance-terminal.mjs --serial ZK-CLF-0001 --key dev_… --in 1002 --offline
```

`npm run db:demo` registers a terminal per branch and prints its key once.

**What this does not prove** is that a real ZKTeco or eSSL will talk to that
endpoint. They will not: those devices speak their own protocol over the LAN
and most push nothing to the internet at all. Something has to translate — a
small agent on the restaurant's network, a device model that supports HTTP
push, or the per-vendor adapter still deferred. This script is the contract
that translation has to satisfy, and it is a faster thing to hand a hardware
supplier than a description of the endpoint.

Phase 12 covers the same endpoint in CI: a missing key and a wrong key are
refused, a batch is accepted with its cursor advanced, an unknown badge is
kept as unmatched rather than dropped, and a re-sync counts duplicates instead
of doubling everybody's hours.

### When the year runs out

Nothing creates next year automatically, and that is deliberate: a year's shape
is a business decision — a short transition year, a changed year end — and an
auto-created wrong year is worse than none, because periods that have been
posted into cannot be deleted (`JournalEntry.period` is `onDelete: Restrict`)
and an overlapping year then blocks the correct one.

Instead:

* **A posting with no period is parked, not failed.** The outbox gives an event
  eight attempts and then marks it FAILED for good, which would be the wrong
  answer here — `postMissingEntries` can recover orders, payments, receipts and
  production runs, but nothing recovers a wastage write-off, a refund, a cash
  session or an expense. So that one refusal, marked with a reason code in
  `accounting/posting-errors.js`, moves the event to **BLOCKED**: out of the
  claim query, attempt count untouched, reason recorded. Creating a fiscal year
  releases every blocked event, and the daily maintenance cycle sweeps as a
  safety net. A lapsed calendar is therefore a delay, not a hole.
* **The people who can open a year are warned.** The maintenance cycle warns at
  60, 30 and 7 days, once per step rather than every morning, and daily once the
  calendar has lapsed. It is addressed by the grant the create endpoint itself
  checks (`accounting_periods.close`) — including super admins, who hold it by
  flag and may have no role rows at all — and reports its *audience*, because a
  fan-out that reaches nobody is the quietest way for a warning to fail.
* **The form offers the next year.** The day after the latest year on file,
  running twelve months, named from the month it starts in. It follows the books
  rather than `FISCAL_YEAR_START_MONTH`, so a business that ran an odd year
  keeps its own calendar, and every field stays editable.

The dashboard carries the same notice, for the same people, because none of this
has a symptom anywhere else: orders, payments and stock keep working when the
calendar runs out, and the ledger is the only thing that stops.

The seed never corrects a calendar that is already there. If a period covers
today it is left alone whatever its shape, and if a year overlaps the one it
would open but has no period for today, it reports that and creates nothing —
overlapping years would make "which period does this date belong to" ambiguous,
and a year with a hole in it is somebody's mistake to look at rather than a
seed's to paper over. Each year after the first is created from the fiscal
calendar screen; nothing creates next year automatically.

### Deferred from Phase 12

- [ ] **Device pull/sync** — terminals push to `/devices/punches`. Polling a
      device over its own vendor protocol needs a per-vendor adapter and a
      worker that can reach the LAN the device sits on
- [x] **Payslip PDFs** — rendered through pdfkit for an admin and for the
      employee themselves; the payslip shows the arithmetic, not just the
      answer. Previously: `pdfUrl` is modelled; rendering and storing the
      document is its own piece of work
- [ ] **Statutory deductions** — provident fund, income tax and social security
      are expressible as salary components, but the rules that compute them per
      jurisdiction are not built. The withheld total posts to tax payable
- [ ] **Overtime approval** — overtime is derived from time worked beyond the
      shift and paid automatically; a pre-approval workflow is not modelled
- [ ] **Attendance regularisation requests** — an employee raising their own
      correction for a supervisor to approve; today only a supervisor can
      correct a day
- [ ] **Shift swaps and open shifts** — the roster is assigned, not bid on
- [x] **HR operational report** — the Attendance report, branch-scoped on
      `reports.view_hr`, showing days worked, hours and unapproved days per
      employee

## Phase 13 — Creator Program

- [x] **Creator onboarding** — eligibility proved from a completed order, terms
      versioned and acceptance pinned to the version seen, profile on the same
      user account
- [x] **Video upload** — bound to one purchased `OrderItem`, duration and size
      enforced from config, every attempt kept
- [x] **Moderation** — review queue, approve/reject with a required reason and
      recorded checks, attempt limit locks the line, takedown and reinstate,
      viewer reports, strikes with automatic suspension and ban
- [x] **Public video feed** — videos on the product page, a creator page, a
      browse feed, add-to-cart carrying the video
- [x] **Attribution** — created only on add-to-cart, one row per cart+product,
      last touch wins with every touch kept, survives a guest-cart merge,
      window expiry, frozen onto the order at checkout
- [x] **Commission rules** — CRUD, single-winner resolution, and a simulator
- [x] **Earnings engine** — runs on completion, hold window, crediting job,
      reversal on refund, `NOT_QUALIFIED` rows for near-misses
- [x] **Creator wallet** — append-only ledger with a rebuildable cached balance,
      redemption quote with a per-order cap, expiry
- [x] **Engagement & sharing** — views, likes, share links, click tracking,
      daily rollups, milestone appreciation
- [x] **Creator dashboard API** — earnings, the views→carts→orders funnel, and
      the appreciation feed

### Design notes

- **A view attributes nothing; only add-to-cart does.** A product page with six
  videos would otherwise credit all six for a sale any of them, or none of them,
  caused — and whichever video sorted first would win every time.
- **Exactly one commission rule applies per line.** Never stacked: two
  overlapping campaigns paying together produce a promotion nobody modelled and
  an unbounded payout. Priority, then specificity, then recency.
- **A sale that earns nothing still writes a row.** `NOT_QUALIFIED` with the
  reason, so the dashboard can say "your video drove this sale but it missed the
  threshold" instead of showing silence — which is indistinguishable from the
  program being broken.
- **Proof of purchase is structural.** A video is bound to the order line the
  creator bought, and the product it goes live against comes from that line, not
  from the request.
- **Earnings snapshot the rule.** Editing a campaign next month must not rewrite
  what somebody was already paid.
- **Store credit is an append-only ledger** with a cached balance and a
  `rebuildBalances` replay, the same shape as the stock ledger.

### Fixed while building Phase 13

- **A guest cart merged at sign-in destroyed its attributions.**
  `CreatorAttribution` cascades from `Cart`, and `claimGuestCart` deletes the
  guest cart after moving its items — so a shopper who added from a video and
  only signed in at checkout silently cost the creator the sale, in precisely
  the flow the program depends on most. Attributions now move across first, with
  last-touch still deciding any clash.

### Deferred from Phase 13

- [x] **Store credit as a tender at checkout** — `POST /checkout` takes a
      `storeCredit` amount, re-derives the ceiling rather than trusting it, and
      spends the credit inside the order's own transaction: the ledger debit,
      the `STORE_CREDIT` payment and the order commit together or not at all.
      The bill is unchanged — credit pays it, it does not discount it — so the
      receipt posts against customer credit rather than cash. Refused outright
      when over the cap, because spending less than asked quietly charges the
      difference to a card. The checkout page offers it, says why the cap bites,
      and the confirmation states what is left to pay
- [ ] **Video transcoding and moderation automation** — uploads are validated on
      declared duration and size; a real pipeline would probe the file, generate
      thumbnails, and pre-screen for nudity before a human sees it
- [ ] **Attribution beyond last touch** — no fractional or multi-touch model
- [ ] **Creator payouts in cash** — deliberately out of scope; the program is
      store credit only
- [ ] **Leaderboards and `TOP_CREATOR_OF_WEEK`** — the appreciation type exists,
      the job that awards it does not
- [ ] **Creator report** — `reports.view_creator` exists and the data is here

## Phase 14 — Cross-cutting

- [x] **Background jobs** — an interval loop (`WORKER_IN_PROCESS=true`) or cron
      hitting `/api/internal/jobs/*`, both claiming with `SKIP LOCKED` so they
      are safe to run at once. Covers the outbox drain, attendance folding,
      earning crediting, cart and attribution expiry, stat rollups, credit
      expiry, batch expiry and low-stock alerts. Every nightly job is in
      `vercel.json`; the in-process loop drains the outbox only, so a VPS
      needs cron for the rest — see the table in `docs/API.md`.
- [ ] **Realtime** — order status and driver location channels for both clients
- [ ] **Search** — product and order search
- [x] **API documentation** — OpenAPI 3.1 generated from the route options by
      `npm run docs:api`, served as Swagger UI at `/api/docs`; `docs/API.md`
      stays the narrative and is kept current per module
- [ ] **Security hardening** — rate-limit tuning, distributed limiter store,
      CORS review, secret rotation, dependency audit
- [ ] **Observability** — error tracking, request metrics, slow-query logging
- [ ] **Deployment** — environments, migration strategy, backups, restore drill

---

## Sequencing notes

- **Phase 1 → 3 → 5 is the critical path** to a working ordering system. Phases
  6–8 make it complete; 9–11 make it a business.
- **Phase 11 (Finance) depends on 5, 7, 9, 10 and 12** — the ledger posts from
  those events, so build the posting rules only once the events exist.
- **Phase 12's payroll depends on attendance derivation**, which depends on punch
  ingestion. Do not start payroll before punches are landing correctly.
- **Phase 13 depends on ordering (5) and payments (7)**, and its wallet-as-tender
  work loops back into Phase 7.
- **Decide the payment provider before Phase 7** — it changes the adapter, the
  webhook contract and the refund flow.
