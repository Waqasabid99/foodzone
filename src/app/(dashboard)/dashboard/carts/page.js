import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { cartSummary, listCarts } from "@/server/services/cart-admin.service";
import { scopedBranches } from "@/server/content/service-admin";
import { ORDER_TYPE_LABELS, cartOwner, cartState } from "@/lib/service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Live carts — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Who is mid-order right now.
 *
 * A support screen, not an analytics one. Somebody rings to say they cannot
 * check out, and this is how the person answering sees what they are looking
 * at. Read-only on purpose: a member of staff silently changing what is in
 * somebody's basket while they are looking at it is a support tool that
 * creates support calls.
 *
 * Empty baskets are hidden by default. A cart row exists the moment anybody
 * opens the menu, so the unfiltered table is mostly rows with nothing in them,
 * and a list that is mostly noise is one nobody reads.
 */
export default async function CartsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/carts"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "carts.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "carts.read");

  const branches = await scopedBranches(principal, "carts.read");
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const identity = ["SIGNED_IN", "GUEST"].includes(one(params.identity)) ? one(params.identity) : "";
  const abandoned = one(params.abandoned) === "1";
  const search = one(params.q)?.trim() || "";
  const cursor = one(params.cursor) || undefined;

  const [summary, page] = await Promise.all([
    cartSummary({ scope }),
    listCarts({
      ...(branch ? { branchId: branch } : {}),
      ...(identity ? { identity } : {}),
      ...(abandoned ? { staleMinutes: 30 } : {}),
      ...(search ? { search } : {}),
      scope,
      limit: PAGE_SIZE,
      cursor,
    }).catch((error) => {
      if (cursor) return listCarts({ scope, limit: PAGE_SIZE });
      throw error;
    }),
  ]);
  const carts = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { branch, identity, abandoned: abandoned ? "1" : "", q: search, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/carts?${text}` : "/dashboard/carts";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live carts"
        description="Baskets being filled right now, and the ones somebody walked away from. Read-only — this is for answering the phone, not for editing what a customer is holding."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Baskets with something in them" value={summary.active} />
        <StatTile label={`Untouched for ${summary.staleMinutes}+ min`} value={summary.stale} />
        <StatTile label="Not signed in" value={summary.guests} />
      </div>

      <ListFilters
        id="carts"
        fields={[
          { type: "search", name: "q", label: "Search", value: search, placeholder: "Customer name, email or phone" },
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
            name: "identity",
            label: "Who",
            value: identity,
            options: [
              { value: "", label: "Everyone" },
              { value: "SIGNED_IN", label: "Signed in" },
              { value: "GUEST", label: "Guests" },
            ],
          },
          { type: "checkbox", name: "abandoned", label: "Abandoned only", value: abandoned },
        ]}
      />

      {carts.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {carts.map((cart) => {
              const state = cartState(cart);
              return (
                <li key={cart.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/carts/${cart.id}`} className="text-label-bold text-on-surface hover:underline">
                        {cartOwner(cart)}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {cart.unitCount} {cart.unitCount === 1 ? "item" : "items"} ·{" "}
                      {ORDER_TYPE_LABELS[cart.type] ?? cart.type}
                      {cart.branch?.name ? ` · ${cart.branch.name}` : " · no branch chosen"}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {cart.products.map((row) => `${row.quantity}× ${row.name}`).join(", ")}
                      {cart.lineCount > cart.products.length ? ` and ${cart.lineCount - cart.products.length} more` : ""}
                    </p>
                  </div>
                  {cart.user?.phone ? (
                    <a href={`tel:${cart.user.phone}`} className="text-label-bold text-primary hover:underline">
                      {cart.user.phone}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Most recent
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="text-body-md text-on-surface-variant">
              Empty baskets are left out — a cart row is created the moment anybody opens the menu.
            </p>
          )}
        </>
      ) : (
        <EmptyState icon={ShoppingCart} title={search || abandoned || identity ? "Nothing matches" : "Nobody is shopping right now"}>
          {search || abandoned || identity
            ? "Try a wider filter."
            : "When somebody is filling a basket on the website or the app, they appear here while they do it."}
        </EmptyState>
      )}
    </div>
  );
}
