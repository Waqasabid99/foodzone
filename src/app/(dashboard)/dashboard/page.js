import { redirect } from "next/navigation";
import Link from "next/link";
import { ChefHat, HandPlatter, PackageX, Plus, ShoppingCart, Utensils } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";
import ChartCard from "@/components/dashboard/ChartCard";
import RevenueTrend from "@/components/dashboard/RevenueTrend";
import BarBreakdown from "@/components/dashboard/BarBreakdown";
import LiveQueue from "@/components/dashboard/LiveQueue";
import QueueHealth from "@/components/dashboard/QueueHealth";
import FiscalRunway from "@/components/dashboard/finance/FiscalRunway";
import KitchenShortcuts from "@/components/dashboard/KitchenShortcuts";
import SetAsideTickets from "@/components/dashboard/service/SetAsideTickets";
import BillRequests from "@/components/dashboard/service/BillRequests";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope } from "@/lib/api/permissions";
import { getSiteIdentity } from "@/server/content/site";
import { dashboardOverview } from "@/server/services/dashboard.service";
import { outboxStats } from "@/server/jobs/outbox";
import { kitchenSummary, setAsideTickets } from "@/server/services/kds.service";
import { billRequests } from "@/server/services/order.service";
import { scopedBranches, stationOptions } from "@/server/content/service-admin";
import { userNames } from "@/server/content/finance-admin";
import { serialize } from "@/lib/api/serialize";
import { queueHealth } from "@/lib/queue-health";
import { runwayNotice } from "@/lib/fiscal-runway";
import { fiscalRunway } from "@/server/services/fiscal.service";
import { hasPermission, firstNavHref, DASHBOARD_NAV } from "@/lib/dashboard-nav";
import { homeFor, HOME_PATHS, worksTheFloor } from "@/lib/home-page";
import { formatMoney } from "@/lib/format";

export const metadata = {
  title: "Dashboard — FoodZone",
  robots: { index: false, follow: false },
};

/** Reads a live session, so it cannot be prerendered or revalidated on a timer. */
export const dynamic = "force-dynamic";

/**
 * The overview.
 *
 * Every block asks its own permission before it is loaded, so the page is not
 * one screen with things blanked out — it is a different, complete screen for
 * each person. A shift supervisor who cannot read reports sees the pass and
 * nothing that looks like a hole where the money used to be.
 *
 * The figures are deliberately labelled with what they count. "Sales today"
 * here means orders placed today that were not cancelled, at whatever stage —
 * which is what an owner means by the phrase and is *not* what the accounting
 * sales report counts. Rather than quietly pick one, the screen says which.
 */
export default async function DashboardPage() {
  // The viewer carries the permissions the page branches on; the principal is
  // what branch scoping is measured against, and only the kitchen block needs it.
  const [viewer, { currency, storeName }, principal] = await Promise.all([
    getWorkspaceViewer(),
    getSiteIdentity(),
    getAuthContext(),
  ]);
  if (!viewer) redirect("/login");

  /*
   * Whether this screen is theirs at all.
   *
   * Two separate questions used to be one. A driver holds deliveries but not
   * `dashboard.view` and is sent to the first door they hold — that is still
   * here. The new one is a cook: they *may* read this page, and there is
   * nothing on it they can use. A kitchen display belongs on a screen of its
   * own, so they open on the board instead, and anyone can override it from
   * their own account.
   *
   * A redirect rather than drawing the board here, because the board keeps its
   * station in the URL and a fryer screen that cannot be pinned to the fryer
   * is not a fryer screen.
   */
  const home = homeFor({ permissions: viewer.permissions, preference: viewer.homePage });
  if (home !== HOME_PATHS.overview) redirect(home);

  const can = (block) =>
    ({
      sales: () => hasPermission(viewer.permissions, "reports.view_sales"),
      orders: () => hasPermission(viewer.permissions, "orders.read"),
      inventory: () => hasPermission(viewer.permissions, "reports.view_inventory"),
    })[block]?.() ?? false;

  /*
   * Scoped to what this person actually holds.
   *
   * Without the scope the overview queried every branch, so a branch manager
   * opened the company's revenue, best sellers and live queue on the screen
   * they see most — while their own role carries
   * `excludes: ["orders.read_all_branches"]` to forbid exactly that.
   *
   * `dashboard.view` is the right key because it is the one that opens this
   * page: a grant pinned to one outlet scopes the page to that outlet, and a
   * company-wide grant leaves it uncut.
   */
  const data = await dashboardOverview({
    can,
    scope: branchScope(principal, "dashboard.view"),
    trendDays: 14,
  });

  /*
   * Whether the background queue is still moving.
   *
   * Asked only of people who could do something about it — a stalled worker is
   * an administrator's problem, and a cashier shown a red banner mid-shift can
   * only be alarmed by it. `settings.read` is the closest existing stand-in
   * for "runs this system": every role that holds it is one that would escalate.
   */
  /*
   * The kitchen's own block, for anyone who reads a board.
   *
   * It goes above everything else on purpose. Somebody working a pass opens
   * this once a shift with their hands already dirty, and the previous screen
   * gave them order counts and no way into the board at all — the one screen
   * their entire job happens on was sidebar-only.
   */
  /*
   * Not everyone who reads a board works one. A waiter holds `kds.read` too,
   * and leading their day with "open the board" and a row of station chips
   * was handing them the cook's screen — a fryer they do not work, a "start
   * it" they should never press. Their home is the pass, and the link below
   * is to that instead.
   */
  const readsKitchen = hasPermission(viewer.permissions, "kds.read");
  const onTheFloor = worksTheFloor(viewer.permissions);
  const kitchen = readsKitchen && !onTheFloor ? await kitchenBlock(principal) : null;

  /*
   * Tables waiting to pay.
   *
   * Shown to whoever can do something about it — the till settles them, and
   * the floor can see its own asks have landed. Like the set-aside block, it
   * is on the overview rather than on a page of its own: nobody goes looking
   * for a screen about a thing they do not know has happened.
   */
  const seesBills = hasPermission(viewer.permissions, "orders.read");
  const waitingToPay = seesBills ? await billRequestBlock(principal) : null;

  /*
   * Tickets the kitchen handed back.
   *
   * Shown to whoever can do something about them — the till — rather than to
   * the kitchen that set them aside. It is the half that stops "set aside"
   * being a bin: the order is still live and still owed, so it has to land in
   * front of a person who can either send it back or cancel it.
   */
  const handlesOrders = hasPermission(viewer.permissions, "orders.update_status");
  const handedBack = handlesOrders ? await handedBackBlock(principal) : null;

  const watchesSystem = hasPermission(viewer.permissions, "settings.read");
  const health = watchesSystem
    ? queueHealth(await outboxStats().catch(() => null) ?? {})
    : null;

  /*
   * Whether the books still have a period to post into.
   *
   * Asked only of people who can open a year — the same grant the create
   * endpoint checks — because nobody else can act on it, and a banner you
   * cannot act on is a banner you learn to scroll past.
   *
   * On the overview rather than only on the periods page: this has no symptom
   * anywhere until it is overdue. Orders, payments and stock all keep working
   * when the calendar runs out; the ledger is the only thing that stops, and
   * nobody opens the ledger to check it is being written to.
   */
  const opensYears = hasPermission(viewer.permissions, "accounting_periods.close");
  const runway = opensYears ? runwayNotice(await fiscalRunway().catch(() => ({}))) : null;

  const today = data.today;
  const delta =
    today && data.previous && Number(data.previous.netSales) > 0
      ? Math.round(
          ((Number(today.netSales) - Number(data.previous.netSales)) / Number(data.previous.netSales)) * 100,
        )
      : null;

  const trendTotal = data.trend?.reduce((sum, day) => sum + day.revenue, 0) ?? 0;

  /*
   * Whether this person sees the money.
   *
   * A cashier does not: no sales figures, no revenue trend, no best sellers.
   * Which left them a two-column overview with one card in the narrow column
   * and a screen-high blank where the reports would be — a page that looks
   * broken rather than one tailored to them. When there is nothing to put in
   * the wide column, there is no wide column, and the space goes to what a
   * counter actually needs: the way into an order.
   */
  const readsReports = Boolean(data.trend || data.topSellers || today);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-headline-lg text-on-surface">
          {greeting()}, {viewer.name?.split(" ")[0] ?? "there"}
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          How {storeName} is doing today.
        </p>
      </header>

      <QueueHealth health={health} />
      <FiscalRunway notice={runway} />

      {handedBack?.tickets?.length ? (
        <SetAsideTickets
          tickets={handedBack.tickets}
          names={handedBack.names}
          currency={currency}
          canRecall={handlesOrders}
        />
      ) : null}

      {waitingToPay?.tickets?.length ? (
        <BillRequests
          tickets={waitingToPay.tickets}
          names={waitingToPay.names}
          currency={currency}
          canSettle={hasPermission(viewer.permissions, "payments.capture")}
        />
      ) : null}

      {kitchen ? (
        <KitchenShortcuts
          branchId={kitchen.branchId}
          stations={kitchen.stations}
          summary={kitchen.summary}
          late={kitchen.summary?.lateOrders ?? 0}
        />
      ) : null}

      {today ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Sales today"
            value={formatMoney(today.netSales, currency)}
            delta={delta}
            note={delta == null ? "Orders placed today, excluding cancelled" : "vs all of yesterday"}
          />
          <StatTile label="Orders today" value={today.orders} note="Excluding cancelled" />
          <StatTile
            label="Average order"
            value={formatMoney(today.averageOrderValue, currency)}
            note="Across today's orders"
          />
          <StatTile
            label="Settled"
            value={formatMoney(today.settled, currency)}
            note={
              Number(today.awaitingCloseOut) > 0
                ? `${formatMoney(today.awaitingCloseOut, currency)} delivered, not yet closed`
                : "Closed out and posted"
            }
          />
        </div>
      ) : null}

      {hasPermission(viewer.permissions, "orders.create") ? <CounterShortcuts permissions={viewer.permissions} /> : null}

      <div className={`grid gap-5 xl:items-start ${readsReports ? "xl:grid-cols-[2fr_1fr]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-5">
          {data.trend ? (
            <ChartCard
              title="Revenue"
              subtitle={`Last ${data.trendDays} days · ${formatMoney(trendTotal, currency)} total`}
              columns={[
                { key: "day", label: "Day" },
                { key: "orders", label: "Orders", align: "right" },
                { key: "revenue", label: "Revenue", align: "right" },
              ]}
              rows={data.trend.map((day) => ({
                key: day.date,
                day: new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
                orders: day.orders,
                revenue: formatMoney(day.revenue, currency),
              }))}
            >
              <RevenueTrend data={data.trend} currency={currency} />
            </ChartCard>
          ) : null}

          {data.topSellers ? (
            <ChartCard
              title="Best sellers"
              subtitle={`By revenue, last ${data.trendDays} days`}
              columns={[
                { key: "name", label: "Item" },
                { key: "quantity", label: "Sold", align: "right" },
                { key: "revenue", label: "Revenue", align: "right" },
              ]}
              rows={data.topSellers.map((item) => ({
                key: item.name,
                name: item.name,
                quantity: item.quantity,
                revenue: formatMoney(item.revenue, currency),
              }))}
            >
              {data.topSellers.length ? (
                <BarBreakdown
                  currency={currency}
                  height={Math.max(160, data.topSellers.length * 38)}
                  data={data.topSellers.map((item) => ({
                    label: item.name,
                    value: item.revenue,
                    meta: `${item.quantity} sold`,
                  }))}
                />
              ) : (
                <Empty>Nothing has sold in the last {data.trendDays} days.</Empty>
              )}
            </ChartCard>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {data.queue ? <LiveQueue queue={data.queue} /> : null}

          {data.types ? (
            <ChartCard
              title="How they ordered"
              subtitle="Today, by revenue"
              columns={[
                { key: "label", label: "Type" },
                { key: "orders", label: "Orders", align: "right" },
                { key: "revenue", label: "Revenue", align: "right" },
              ]}
              rows={data.types.map((row) => ({
                key: row.type,
                label: row.label,
                orders: row.orders,
                revenue: formatMoney(row.revenue, currency),
              }))}
            >
              <BarBreakdown
                currency={currency}
                height={160}
                data={data.types.map((row) => ({
                  label: row.label,
                  value: row.revenue,
                  meta: `${row.orders} ${row.orders === 1 ? "order" : "orders"}`,
                }))}
              />
            </ChartCard>
          ) : null}

          {data.stock ? <StockCard stock={data.stock} currency={currency} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The counter's way in.
 *
 * Someone taking orders on their feet needs one big target, not a menu to read
 * — and the three screens they move between all shift during a service, so
 * they are here rather than four clicks into the sidebar. Each is shown only
 * if they can open it: a shortcut to a permission error is worse than no
 * shortcut.
 */
/**
 * The kitchen's branch, its stations and how much work is up.
 *
 * One branch, like the board itself: a kitchen is a room, and a number that
 * adds two rooms together is a number nobody in either of them can act on.
 */
async function kitchenBlock(principal) {
  const branches = (await scopedBranches(principal, "kds.read")).filter((row) => row.isActive);
  const branch = branches[0];
  if (!branch) return null;

  const [summary, stations] = await Promise.all([
    kitchenSummary({ branchId: branch.id }).catch(() => null),
    stationOptions().catch(() => []),
  ]);

  return { branchId: branch.id, stations, summary };
}

/** The set-aside pile at this person's branch, with who set each one aside. */
async function handedBackBlock(principal) {
  const branches = (await scopedBranches(principal, "orders.read")).filter((row) => row.isActive);
  const branch = branches[0];
  if (!branch) return null;

  const tickets = serialize(await setAsideTickets({ branchId: branch.id }).catch(() => []));
  const names = tickets.length ? await userNames(tickets.map((row) => row.setAsideById)) : {};
  return { tickets, names };
}

/** Tables that have asked to settle, for whoever can do something about it. */
async function billRequestBlock(principal) {
  const branches = (await scopedBranches(principal, "orders.read")).filter((row) => row.isActive);
  const branch = branches[0];
  if (!branch) return null;

  const tickets = serialize(await billRequests({ branchId: branch.id }).catch(() => []));
  const names = tickets.length ? await userNames(tickets.map((row) => row.billRequestedById)) : {};
  return { tickets, names };
}

function CounterShortcuts({ permissions }) {
  const links = [
    { href: "/dashboard/pass", label: "The pass", icon: HandPlatter, key: "kds.read" },
    { href: "/dashboard/kitchen", label: "Kitchen", icon: ChefHat, key: "kds.read" },
    { href: "/dashboard/tables", label: "Tables", icon: Utensils, key: "tables.read" },
    { href: "/dashboard/carts", label: "Live carts", icon: ShoppingCart, key: "carts.read" },
  ].filter((link) => hasPermission(permissions, link.key));

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-card bg-surface-container-lowest p-5">
      <Link
        href="/dashboard/orders/new"
        className="inline-flex items-center gap-2 rounded-field bg-primary-container px-6 py-3.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus aria-hidden="true" className="size-5" />
        Take an order
      </Link>

      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="inline-flex items-center gap-2 rounded-field bg-surface-container-high px-5 py-3.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <link.icon aria-hidden="true" className="size-4" />
          {link.label}
        </Link>
      ))}
    </section>
  );
}

function StockCard({ stock, currency }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-headline-md text-on-surface">Stock</h2>
        <Link
          href="/dashboard/stock"
          className="text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Open
        </Link>
      </div>

      <p className="font-display text-headline-lg text-on-surface tabular-nums">
        {formatMoney(stock.totalValue, currency)}
      </p>
      <p className="text-label-bold font-normal text-on-surface-variant">
        On hand across {stock.itemCount} {stock.itemCount === 1 ? "item" : "items"}, at average cost
      </p>

      {stock.belowReorder > 0 ? (
        <p className="flex items-start gap-2 rounded-field bg-warning-container px-4 py-3 text-label-bold text-on-warning-container">
          <PackageX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {stock.belowReorder} {stock.belowReorder === 1 ? "item is" : "items are"} at or below the reorder
          level.
        </p>
      ) : null}
    </section>
  );
}

function Empty({ children }) {
  return <p className="py-8 text-center text-body-md text-on-surface-variant">{children}</p>;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
