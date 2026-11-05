import Link from "next/link";
import { redirect } from "next/navigation";
import { IdCard, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listDrivers } from "@/server/services/driver.service";
import { cashOnTheRoad, scopedBranches } from "@/server/content/delivery-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { DRIVER_STATES, availability, lastSeen, licenceState, vehicleLabel } from "@/lib/delivery";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Drivers — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Who rides for the restaurant.
 *
 * The tile that matters is the cash one. COD collected is the restaurant's
 * money sitting in people's bags until the end of a shift, and nobody notices
 * it growing unless it is counted somewhere.
 */
export default async function DriversPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/drivers"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "drivers.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "drivers.read");

  const [branches, { currency }, cash] = await Promise.all([
    scopedBranches(principal, "drivers.read"),
    getSiteIdentity(),
    cashOnTheRoad(principal),
  ]);

  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const status = DRIVER_STATES[one(params.status)] ? one(params.status) : "";
  const canCreate = hasPermission(permissions, "drivers.create");

  const page = await listDrivers({
    ...(branch ? { branchId: branch } : {}),
    ...(status ? { status } : {}),
    scope,
    limit: PAGE_SIZE,
  });
  const drivers = serialize(page.items);
  const onShift = drivers.filter((driver) => DRIVER_STATES[driver.status]?.canTake).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Drivers"
        description="The people who carry the food, what they ride, and what they are holding."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/drivers/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add driver
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Drivers" value={drivers.length} />
        <StatTile label="On shift now" value={onShift} />
        <StatTile label="Cash in their bags" value={formatMoney(cash.total, currency)} note="Collected on delivery, not yet handed over" />
      </div>

      <ListFilters
        id="drivers"
        fields={[
          ...(branches.length > 1
            ? [
                {
                  type: "select",
                  name: "branch",
                  label: "Branch",
                  value: branch,
                  options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))],
                },
              ]
            : []),
          {
            type: "select",
            name: "status",
            label: "Status",
            value: status,
            options: [
              { value: "", label: "Everyone" },
              ...Object.entries(DRIVER_STATES).map(([value, row]) => ({ value, label: row.label })),
            ],
          },
        ]}
      />

      {drivers.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {drivers.map((driver) => {
            const state = DRIVER_STATES[driver.status] ?? { label: driver.status, tone: "" };
            const room = availability(driver);
            const seen = lastSeen(driver.lastLocationAt);
            const licence = licenceState(driver.licenseExpiry);
            return (
              <li key={driver.id} className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/drivers/${driver.id}`} className="text-label-bold text-on-surface hover:underline">
                    {driver.user?.name ?? "Unnamed driver"}
                  </Link>
                  <Chip tone={state.tone}>{state.label}</Chip>
                  {driver.isActive ? null : <Chip>No longer riding</Chip>}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  {vehicleLabel(driver.vehicleType)}
                  {driver.vehicleNumber ? ` · ${driver.vehicleNumber}` : ""}
                  {" · "}
                  {room.active ?? 0} of {room.max ?? 1} jobs
                </p>
                <p className="text-body-md text-on-surface-variant">
                  Position <span className={seen.tone}>{seen.label.toLowerCase()}</span>
                  {Number(driver.cashInHand) > 0 ? ` · holding ${formatMoney(driver.cashInHand, currency)}` : ""}
                </p>
                {licence ? <span className={`w-fit rounded-full px-2.5 py-1 text-label-bold ${licence.tone}`}>{licence.label}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={IdCard} title="No drivers yet" action={canCreate ? { href: "/dashboard/drivers/new", label: "Add the first one" } : null}>
          A driver is built on top of a sign-in account, so they can open the driver app. Create the account under
          Users first if it does not exist.
        </EmptyState>
      )}
    </div>
  );
}
