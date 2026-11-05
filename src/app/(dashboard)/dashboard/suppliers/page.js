import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus, Star } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listSuppliers } from "@/server/services/supplier.service";
import { termLabel } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Suppliers — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Who the restaurant buys from.
 *
 * Company-wide rather than per branch, and deliberately so: one company
 * negotiates one price list, and every outlet buys against it. What each
 * outlet actually *spends* is branch data and lives on the orders and the
 * bills, both of which are scoped.
 */
export default async function SuppliersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/suppliers"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "suppliers.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const search = one(params.q)?.trim() || "";
  const showing = one(params.showing) === "all" ? "all" : "active";
  const cursor = one(params.cursor) || undefined;
  const canCreate = hasPermission(permissions, "suppliers.create");

  const page = await listSuppliers({
    ...(search ? { search } : {}),
    ...(showing === "active" ? { isActive: true } : {}),
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listSuppliers({ limit: PAGE_SIZE });
    throw error;
  });
  const suppliers = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: search, showing: showing === "all" ? "all" : "", ...extra })) {
      if (value) query.set(key, String(value));
    }
    const text = query.toString();
    return text ? `/dashboard/suppliers?${text}` : "/dashboard/suppliers";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Suppliers"
        description="Who the food comes from, what they charge and how long they give you to pay."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/suppliers/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add supplier
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="suppliers"
        fields={[
          { type: "search", name: "q", label: "Search", value: search, placeholder: "Name, code or email" },
          {
            type: "select",
            name: "showing",
            label: "Showing",
            value: showing,
            options: [
              { value: "active", label: "Currently buying from" },
              { value: "all", label: "Everyone, past and present" },
            ],
          },
        ]}
      />

      {suppliers.length ? (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/suppliers/${supplier.id}`} className="text-label-bold text-on-surface hover:underline">
                    {supplier.name}
                  </Link>
                  <span className="font-mono text-label-bold font-normal text-on-surface-variant">{supplier.code}</span>
                  {supplier.isActive ? null : <Chip>Not buying</Chip>}
                  {supplier.rating ? (
                    <span className="inline-flex items-center gap-1 text-label-bold font-normal text-on-surface-variant">
                      <Star aria-hidden="true" className="size-3.5" />
                      {supplier.rating}/5
                    </span>
                  ) : null}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  {supplier.contactPerson ? `${supplier.contactPerson} · ` : ""}
                  {supplier.phone || supplier.email || "No contact recorded"}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  {supplier.itemCount} {supplier.itemCount === 1 ? "item priced" : "items priced"} ·{" "}
                  {supplier.purchaseOrderCount} {supplier.purchaseOrderCount === 1 ? "order" : "orders"} · pay in{" "}
                  {termLabel(supplier.paymentTermDays).toLowerCase()}
                </p>
              </li>
            ))}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  First
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  More
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Building2}
          title={search ? "Nobody by that name" : "No suppliers yet"}
          action={canCreate ? { href: "/dashboard/suppliers/new", label: "Add the first one" } : null}
        >
          {search
            ? "Try a different name, or look at everyone rather than only the active ones."
            : "Add the people you buy from, then agree their prices. Orders and deliveries hang off them."}
        </EmptyState>
      )}
    </div>
  );
}
