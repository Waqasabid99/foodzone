import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import { MapPin, ShieldAlert } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import DeleteSection from "@/components/dashboard/DeleteSection";
import CustomerProfileForm from "@/components/dashboard/customers/CustomerProfileForm";
import CustomerActions from "@/components/dashboard/customers/CustomerActions";
import CustomerOrders from "@/components/dashboard/customers/CustomerOrders";
import Stars from "@/components/ui/Stars";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { getCustomer } from "@/server/services/customer.service";
import { ACCOUNT_STATES, REVIEW_STATES, lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const customer = await getCustomer(id).catch(() => null);
  return { title: customer ? `${customer.name} — Customers — FoodZone` : "Customer — FoodZone", robots: { index: false, follow: false } };
}

/**
 * One customer: who they are, what they have ordered, and what they said about it.
 *
 * Everything counted here is what the viewer may see. For a branch manager
 * that is their own outlet's orders, so the figures on this page and the ones
 * in the list are the same figures rather than two different truths.
 */
export default async function CustomerPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/customers/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "customers.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getCustomer(id, { scope: branchScope(principal, "customers.read") }));
  if (!raw) notFound();

  const [{ currency }] = await Promise.all([getSiteIdentity()]);
  const customer = serialize(raw);
  const { stats, addresses, orders, reviews, branches } = customer;
  const state = ACCOUNT_STATES[customer.status] ?? ACCOUNT_STATES.ACTIVE;
  const canUpdate = hasPermission(permissions, "customers.update");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={customer.name}
        description={[customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details"}
        back={{ href: "/dashboard/customers", label: "Customers" }}
        actions={<span className={`inline-flex w-fit items-center rounded-full px-3 py-1.5 text-label-bold ${state.tone}`}>{state.label}</span>}
      />

      <p className="text-body-md text-on-surface-variant">
        {state.detail} Joined {new Date(customer.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        {customer.lastLoginAt ? ` · last signed in ${lastSeen(customer.lastLoginAt).toLowerCase()}` : " · never signed in"}.
      </p>

      {customer.isStaff ? (
        <p className="flex items-start gap-2 rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          This person is also a staff member. Their roles, suspension and deletion are handled on the Users screen.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Orders" value={String(stats.orders)} note={stats.cancelled ? `${stats.cancelled} cancelled as well` : null} />
        <StatTile label="Spent" value={formatMoney(stats.spend, currency)} note="Excludes cancelled and refunded" />
        <StatTile label="Average order" value={stats.averageOrder ? formatMoney(stats.averageOrder, currency) : "—"} />
        <StatTile label="Last order" value={lastSeen(stats.lastOrderAt)} note={stats.firstOrderAt ? `First ${lastSeen(stats.firstOrderAt).toLowerCase()}` : null} />
      </div>

      {customer.guestOrders ? (
        <p className="text-body-md text-on-surface-variant">
          {customer.guestOrders} of these {customer.guestOrders === 1 ? "was placed" : "were placed"} without signing in, matched to this account by phone number.
        </p>
      ) : null}

      <CustomerProfileForm customer={customer} readOnly={!canUpdate || customer.isStaff} />

      <CustomerOrders orders={orders} currency={currency} truncated={customer.truncated} />

      <Section title="Addresses" description="Where their deliveries go. Customers manage these from their own account.">
        {addresses.length ? (
          <ul className="flex flex-col gap-3">
            {addresses.map((address) => (
              <li key={address.id} className="flex flex-col gap-1 rounded-field bg-surface-container-low p-4 text-body-md">
                <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                  <MapPin aria-hidden="true" className="size-4 text-primary" />
                  {address.label}
                  {address.isDefault ? <span className="rounded-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">Default</span> : null}
                </p>
                <p className="text-on-surface">
                  {[address.line1, address.line2, address.landmark, address.city, address.state, address.postalCode].filter(Boolean).join(", ")}
                </p>
                <p className="text-on-surface-variant">
                  {address.recipientName ? `${address.recipientName} · ` : ""}
                  {address.phone}
                  {address.deliveryNote ? ` · “${address.deliveryNote}”` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">No saved addresses.</p>
        )}
      </Section>

      {branches.length > 1 ? (
        <Section title="Where they order" description="Which outlets they use, by number of orders.">
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

      <Section title="Reviews" description="What they said about their orders. Moderate them from the Reviews screen.">
        {reviews.length ? (
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => {
              const reviewState = REVIEW_STATES[review.status] ?? REVIEW_STATES.PENDING;
              return (
                <li key={review.id} className="flex flex-col gap-1 rounded-field bg-surface-container-low p-4 text-body-md">
                  <p className="flex flex-wrap items-center gap-2">
                    <Stars rating={review.rating} />
                    <span className="text-label-bold text-on-surface">{review.product?.name ?? "The order"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-label-bold ${reviewState.tone}`}>{reviewState.label}</span>
                  </p>
                  {review.comment ? <p className="text-on-surface">{review.comment}</p> : null}
                  <p className="text-on-surface-variant">
                    {new Date(review.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {review.order?.orderNumber ? ` · order ${review.order.orderNumber}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">No reviews yet.</p>
        )}
      </Section>

      {canUpdate && !customer.isStaff ? <CustomerActions customer={customer} /> : null}

      {hasPermission(permissions, "customers.delete") && !customer.isStaff ? (
        <DeleteSection
          title="Close account"
          description="Signs them out, stops them ordering and hides the account. Their orders, invoices and reviews are kept, because the business's records are not theirs alone to erase. To block someone temporarily, suspend them instead."
          endpoint={`/admin/customers/${customer.id}`}
          confirm={`Close ${customer.name}'s account? They will not be able to sign in or order again.`}
          redirectTo="/dashboard/customers"
          success="Account closed."
        />
      ) : null}
    </div>
  );
}
