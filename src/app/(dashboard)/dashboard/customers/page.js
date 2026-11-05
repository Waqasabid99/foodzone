import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, Users } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import CustomerFilters from "@/components/dashboard/customers/CustomerFilters";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { getSiteIdentity } from "@/server/content/site";
import { listCustomers } from "@/server/services/customer.service";
import { ACCOUNT_STATES, lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Customers — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Everyone who has ordered — registered accounts and the phone numbers behind
 * guest orders, in one list, most recent first.
 *
 * Scoped by `branchScope`: holding `customers.read` at one outlet answers "may
 * they see customers?", not "whose?", and a single-branch manager opening the
 * company's whole customer list is exactly what that distinction prevents.
 */
export default async function CustomersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/customers"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "customers.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const q = one(params.q)?.trim() ?? "";
  const kind = ["ACCOUNT", "GUEST"].includes(one(params.kind)) ? one(params.kind) : "";
  const offset = Math.max(0, Number(one(params.offset)) || 0);

  const [{ currency }, { items, total }] = await Promise.all([
    getSiteIdentity(),
    listCustomers({
      ...(q ? { search: q } : {}),
      ...(kind ? { kind } : {}),
      scope: branchScope(principal, "customers.read"),
      limit: PAGE_SIZE,
      offset,
    }),
  ]);

  const filtered = Boolean(q || kind);
  const href = (nextOffset) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (kind) search.set("kind", kind);
    if (nextOffset) search.set("offset", String(nextOffset));
    const query = search.toString();
    return query ? `/dashboard/customers?${query}` : "/dashboard/customers";
  };

  const exportSearch = new URLSearchParams();
  if (q) exportSearch.set("search", q);
  if (kind) exportSearch.set("kind", kind);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Everyone who has ordered — accounts they created, and guests grouped by the phone number on their orders."
        actions={
          hasPermission(permissions, "customers.export") && total ? (
            <a
              href={`/api/v1/admin/customers/export${exportSearch.size ? `?${exportSearch}` : ""}`}
              className="inline-flex items-center gap-2 rounded-field border border-outline px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Download aria-hidden="true" className="size-4" />
              Export
            </a>
          ) : null
        }
      />

      <CustomerFilters q={q} kind={kind} />

      {items.length ? (
        <>
          <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
            <table className="w-full text-left text-body-md">
              <caption className="sr-only">Customers</caption>
              <thead>
                <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                  <th scope="col" className="px-4 py-3 font-normal">Customer</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Orders</th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-normal sm:table-cell">Spent</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">Last order</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal lg:table-cell">Account</th>
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => {
                  const state = customer.status ? ACCOUNT_STATES[customer.status] : null;
                  const to = customer.kind === "GUEST" ? `/dashboard/customers/guests/${customer.id}` : `/dashboard/customers/${customer.id}`;
                  return (
                    <tr key={`${customer.kind}:${customer.id}`} className="border-b border-outline-variant/60 last:border-0">
                      <td className="px-4 py-3">
                        <Link href={to} className="text-label-bold text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {customer.name}
                        </Link>
                        <p className="text-on-surface-variant">
                          {customer.email ?? customer.phone ?? "No contact details"}
                          {customer.kind === "GUEST" ? " · no account" : ""}
                        </p>
                        <p className="text-on-surface-variant md:hidden">
                          {customer.orders} {customer.orders === 1 ? "order" : "orders"} · {lastSeen(customer.lastOrderAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-on-surface">
                        {customer.orders}
                        {customer.guestOrders ? (
                          <span className="block text-label-bold font-normal text-on-surface-variant">{customer.guestOrders} as guest</span>
                        ) : null}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface sm:table-cell">{formatMoney(customer.spend, currency)}</td>
                      <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">{lastSeen(customer.lastOrderAt)}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {state ? (
                          <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>{state.label}</span>
                        ) : (
                          <span className="text-on-surface-variant">Guest</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-body-md text-on-surface-variant">
            <p>
              {offset + 1}–{offset + items.length} of {total}
            </p>
            <div className="flex gap-2">
              {offset > 0 ? (
                <Link href={href(Math.max(0, offset - PAGE_SIZE))} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Previous
                </Link>
              ) : null}
              {offset + items.length < total ? (
                <Link href={href(offset + PAGE_SIZE)} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <Users aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">{filtered ? "Nobody matches that" : "No customers yet"}</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            {filtered ? "Try a different search." : "Customers appear here as soon as they order, whether or not they created an account."}
          </p>
          {filtered ? <Link href="/dashboard/customers" className="text-label-bold text-primary hover:underline">Clear search</Link> : null}
        </div>
      )}
    </div>
  );
}
