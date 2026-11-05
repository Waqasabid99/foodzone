import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import { UserRound } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import CustomerOrders from "@/components/dashboard/customers/CustomerOrders";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { getGuestCustomer } from "@/server/services/customer.service";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Guest — Customers — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A guest: someone who ordered by phone, at the counter or from a table
 * without signing in.
 *
 * There is no account behind this page — the orders are the only record — so
 * nothing here can be edited. Everything shown is assembled from orders that
 * carry the same phone number.
 */
export default async function GuestCustomerPage({ params }) {
  const { key } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/customers/guests/${key}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "customers.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getGuestCustomer(key, { scope: branchScope(principal, "customers.read") }));
  if (!raw) notFound();
  // They have since registered with this number, and the account is the record.
  if (raw.kind === "ACCOUNT_EXISTS") redirect(`/dashboard/customers/${raw.userId}`);

  const [{ currency }] = await Promise.all([getSiteIdentity()]);
  const guest = serialize(raw);
  const { stats, orders, branches } = guest;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={guest.name}
        description={[guest.phone, guest.email].filter(Boolean).join(" · ")}
        back={{ href: "/dashboard/customers", label: "Customers" }}
        actions={
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-label-bold text-on-surface-variant">
            <UserRound aria-hidden="true" className="size-3.5" />
            No account
          </span>
        }
      />

      <p className="text-body-md text-on-surface-variant">
        These orders were placed without signing in and are grouped by phone number, so this is one page per number rather
        than per person. If they register with this number, their account takes over and this page points at it.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Orders" value={String(stats.orders)} note={stats.cancelled ? `${stats.cancelled} cancelled as well` : null} />
        <StatTile label="Spent" value={formatMoney(stats.spend, currency)} note="Excludes cancelled and refunded" />
        <StatTile label="Average order" value={stats.averageOrder ? formatMoney(stats.averageOrder, currency) : "—"} />
        <StatTile label="Last order" value={lastSeen(stats.lastOrderAt)} note={stats.firstOrderAt ? `First ${lastSeen(stats.firstOrderAt).toLowerCase()}` : null} />
      </div>

      <CustomerOrders orders={orders} currency={currency} truncated={guest.truncated} guest />

      {branches.length > 1 ? (
        <Section title="Where they order" description="Which outlets this number has ordered from.">
          <ul className="flex flex-col gap-2">
            {branches.map((branch) => (
              <li key={branch.id} className="flex items-baseline justify-between gap-3 text-body-md">
                <span className="text-on-surface">{branch.name}</span>
                <span className="tabular-nums text-on-surface-variant">{branch.orders}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
