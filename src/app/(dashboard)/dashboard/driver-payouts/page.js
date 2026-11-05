import Link from "next/link";
import { redirect } from "next/navigation";
import { HandCoins } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import GeneratePayouts from "@/components/dashboard/delivery/GeneratePayouts";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listPayouts } from "@/server/services/driver-payout.service";
import { actionableBranches, payableDrivers, payoutCounts } from "@/server/content/delivery-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { PAYOUT_STATES, dayKey } from "@/lib/delivery";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Driver payouts — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const TABS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "APPROVED", label: "To pay" },
  { value: "PAID", label: "Paid" },
];

/**
 * What the riders are owed.
 *
 * Opens on the drafts, because a draft is arithmetic nobody has agreed yet
 * and it is the only state waiting on a person.
 */
export default async function DriverPayoutsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/driver-payouts"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "driver_payouts.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "driver_payouts.read");

  const [counts, drivers, branches, { currency }] = await Promise.all([
    payoutCounts(principal),
    payableDrivers(principal),
    hasPermission(permissions, "driver_payouts.create") ? actionableBranches(principal, "driver_payouts.create") : [],
    getSiteIdentity(),
  ]);

  const requested = one(params.status);
  const known = TABS.some((row) => row.value === requested);
  const status = known ? requested : counts.DRAFT ? "DRAFT" : "";
  const driverId = drivers.some((row) => row.id === one(params.driver)) ? one(params.driver) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listPayouts({
    ...(status ? { status } : {}),
    ...(driverId ? { driverId } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listPayouts({ scope, limit: PAGE_SIZE });
    throw error;
  });
  const payouts = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, driver: driverId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/driver-payouts?${text}` : "/dashboard/driver-payouts";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Driver payouts"
        description="Earnings and tips for a period, less any of the restaurant's cash the driver is still holding."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {TABS.map((tab) => {
          const active = tab.value === status;
          const count = tab.value ? (counts[tab.value] ?? 0) : Object.values(counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.value, cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
      </div>

      {drivers.length > 1 ? (
        <ListFilters
          id="payouts"
          hidden={{ status: status || null }}
          fields={[
            {
              type: "select",
              name: "driver",
              label: "Driver",
              value: driverId,
              options: [
                { value: "", label: "Everyone" },
                ...drivers.map((row) => ({ value: row.id, label: row.user?.name ?? "Unnamed" })),
              ],
            },
          ]}
        />
      ) : null}

      {payouts.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {payouts.map((payout) => {
              const state = PAYOUT_STATES[payout.status] ?? { label: payout.status, tone: "" };
              const owed = Number(payout.netAmount);
              return (
                <li key={payout.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/driver-payouts/${payout.id}`} className="text-label-bold text-on-surface hover:underline">
                        {payout.driver?.user?.name ?? "Unnamed driver"}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {dayKey(payout.periodStart)} to {dayKey(payout.periodEnd)} · {payout.deliveriesCount}{" "}
                      {payout.deliveriesCount === 1 ? "delivery" : "deliveries"}
                    </p>
                  </div>
                  <p className={`tabular-nums text-body-md ${owed < 0 ? "text-error" : "text-on-surface"}`}>
                    {formatMoney(payout.netAmount, currency)}
                    {owed < 0 ? <span className="block text-label-bold font-normal">they owe us</span> : null}
                  </p>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={HandCoins} title={status ? "Nothing at this stage" : "No payouts yet"}>
          {status ? "Try another tab." : "Work one out below. Nothing is committed until somebody approves it."}
        </EmptyState>
      )}

      {hasPermission(permissions, "driver_payouts.create") && drivers.length ? (
        <GeneratePayouts drivers={serialize(drivers)} branches={serialize(branches)} currency={currency} />
      ) : null}
    </div>
  );
}
