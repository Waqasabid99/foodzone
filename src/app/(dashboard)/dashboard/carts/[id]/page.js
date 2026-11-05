import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getCartDetail } from "@/server/services/cart-admin.service";
import { formatMoney } from "@/lib/format";
import { ORDER_TYPE_LABELS, cartOwner, cartState } from "@/lib/service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Cart — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One basket, priced the way its owner sees it.
 *
 * Run through the checkout pricing engine rather than summed from list
 * prices, because the reason somebody rings is usually that their total is not
 * what they expected — and a support screen quoting a different number from
 * the customer's screen is worse than no screen at all.
 */
export default async function CartPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/carts/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "carts.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getCartDetail(id));
  // A cart with no branch belongs to nobody, so the wall cannot place it and
  // anybody who may read carts may read this one.
  if (!raw || (raw.cart.branchId && !inScope(branchScope(principal, "carts.read"), raw.cart.branchId))) notFound();

  const { cart, owner, branch, priced, pricingError } = serialize(raw);
  // `getPricedCart` nests the money under `totals`; the rest of it is the cart.
  const totals = priced?.totals ?? null;
  const state = cartState(cart);
  const currency = branch?.currency ?? "PKR";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={cartOwner({ ...cart, user: owner })}
        description={`${ORDER_TYPE_LABELS[cart.type] ?? cart.type}${branch ? ` · ${branch.name}` : " · no branch chosen yet"}`}
        back={{ href: "/dashboard/carts", label: "Live carts" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      {owner ? (
        <Section title="Who they are">
          <ul className="flex flex-col gap-1 text-body-md text-on-surface">
            <li>{owner.name ?? "No name on the account"}</li>
            {owner.email ? <li className="break-all text-on-surface-variant">{owner.email}</li> : null}
            {owner.phone ? (
              <li>
                <a href={`tel:${owner.phone}`} className="text-primary hover:underline">{owner.phone}</a>
              </li>
            ) : null}
          </ul>
        </Section>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
          Not signed in, so there is no account and no way to contact them. If they ring, the basket below is what they
          are looking at.
        </p>
      )}

      <Section title="What is in it">
        {cart.items?.length ? (
          <ul className="flex flex-col gap-2">
            {cart.items.map((line) => (
              <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <span className="min-w-0 text-body-md text-on-surface">
                  <strong className="tabular-nums">{line.quantity}×</strong> {line.productName ?? "An item that is no longer on the menu"}
                  {line.notes ? <span className="block text-label-bold font-normal text-on-surface-variant">{line.notes}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">The basket is empty.</p>
        )}
      </Section>

      <Section title="What it would come to">
        {totals ? (
          <dl className="grid gap-2 text-body-md">
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Subtotal</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(totals.subtotal, currency)}</dd>
            </div>
            {Number(totals.discountTotal) ? (
              <div className="flex justify-between gap-4">
                <dt className="text-on-surface-variant">Discount</dt>
                <dd className="tabular-nums text-on-surface">−{formatMoney(totals.discountTotal, currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Tax</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(totals.taxTotal, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
              <dt className="text-label-bold text-on-surface">Total</dt>
              <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(totals.grandTotal, currency)}</dd>
            </div>
          </dl>
        ) : pricingError ? (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            {pricingError} That is usually the same thing the customer is seeing, so it is worth reading as the answer
            rather than as a fault with this screen.
          </p>
        ) : (
          <p className="text-body-md text-on-surface-variant">
            They have not chosen a branch yet, so nothing can be priced — prices and availability are per outlet.
          </p>
        )}
        {cart.couponCode ? (
          <p className="text-body-md text-on-surface-variant">Coupon on the basket: <strong>{cart.couponCode}</strong></p>
        ) : null}
      </Section>
    </div>
  );
}
