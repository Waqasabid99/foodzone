import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import AssignDriver from "@/components/dashboard/delivery/AssignDriver";
import DeliveryActions from "@/components/dashboard/delivery/DeliveryActions";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getDelivery } from "@/server/services/delivery.service";
import { allowedDeliveryTransitions } from "@/server/delivery/state";
import { assignableDrivers } from "@/server/content/delivery-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { DELIVERY_JOURNEY, DELIVERY_STATES, canReassign, vehicleLabel, waitingSince } from "@/lib/delivery";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Delivery — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const when = (value) =>
  value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

/**
 * One delivery: who is carrying it, where it is in the journey, and what the
 * driver owes for it.
 *
 * The transitions come from the server's own graph rather than a second copy
 * kept here — the thing that must never drift is which buttons exist.
 */
export default async function DeliveryPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/deliveries/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "deliveries.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getDelivery(id));
  // Out of scope answers not-found: a delivery carries somebody's home
  // address, and confirming one exists at another outlet is itself a leak.
  if (!raw || !inScope(branchScope(principal, "deliveries.read"), raw.order?.branchId)) notFound();

  const delivery = serialize({ ...raw, nextStatuses: allowedDeliveryTransitions(raw.status) });
  const branchId = raw.order?.branchId;

  // `currency` is not on the delivery's order select, so it is resolved here
  // rather than read off a field that would quietly be undefined.
  const [{ currency }, drivers] = await Promise.all([
    getSiteIdentity(),
    canReassign(delivery) || !delivery.driverId ? assignableDrivers(principal, branchId) : [],
  ]);

  const state = DELIVERY_STATES[delivery.status] ?? { label: delivery.status, tone: "" };
  const wait = waitingSince(delivery.assignedAt ?? delivery.createdAt);
  const reached = DELIVERY_JOURNEY.indexOf(delivery.status);
  const address = delivery.order?.addressSnapshot ?? null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={delivery.order?.orderNumber ?? "Delivery"}
        description={`${delivery.driver?.user?.name ?? "No driver yet"} · ${wait.label} since ${delivery.assignedAt ? "assigned" : "created"}`}
        back={{ href: "/dashboard/deliveries", label: "Deliveries" }}
        actions={
          <>
            <Chip tone={state.tone}>{state.label}</Chip>
            {hasPermission(permissions, "orders.read") && delivery.order?.id ? (
              <Link
                href={`/dashboard/orders/${delivery.order.id}`}
                className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                The order
              </Link>
            ) : null}
          </>
        }
      />

      {/* The journey as a line rather than a list of timestamps: the question
          is "how far along is this", and a reader answers that from a shape
          faster than from six dates. */}
      <ol className="flex flex-wrap gap-2" aria-label="Progress">
        {DELIVERY_JOURNEY.map((step, index) => {
          const done = reached >= 0 && index <= reached;
          return (
            <li
              key={step}
              aria-current={index === reached ? "step" : undefined}
              className={`rounded-field px-3 py-1.5 text-label-bold ${done ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface-variant"}`}
            >
              {DELIVERY_STATES[step]?.label ?? step}
            </li>
          );
        })}
      </ol>

      <DeliveryActions
        delivery={delivery}
        canUpdate={can(principal, "deliveries.update_status", { branchId })}
        canFail={can(principal, "deliveries.mark_failed", { branchId })}
        canReassignJob={can(principal, "deliveries.reassign", { branchId })}
      />

      <Section title="Where it is going">
        <ul className="flex flex-col gap-1 text-body-md text-on-surface">
          <li>{delivery.order?.user?.name ?? delivery.order?.guestName ?? "No name on the order"}</li>
          {delivery.order?.user?.phone || delivery.order?.guestPhone ? (
            <li>
              <a href={`tel:${delivery.order.user?.phone ?? delivery.order.guestPhone}`} className="text-primary hover:underline">
                {delivery.order.user?.phone ?? delivery.order.guestPhone}
              </a>
            </li>
          ) : null}
          {address ? (
            <li className="text-on-surface-variant">
              {[address.line1, address.line2, address.city].filter(Boolean).join(", ")}
              {address.notes ? <span className="block">“{address.notes}”</span> : null}
            </li>
          ) : (
            <li className="text-error">No address on this order — it cannot be delivered until one is set.</li>
          )}
          {delivery.order?.customerNote ? <li className="text-on-surface-variant">“{delivery.order.customerNote}”</li> : null}
        </ul>
      </Section>

      <Section title={delivery.driverId ? "Who is carrying it" : "Nobody is carrying it yet"}>
        {delivery.driverId ? (
          <ul className="flex flex-col gap-1 text-body-md text-on-surface">
            <li>
              <Link href={`/dashboard/drivers/${delivery.driverId}`} className="text-label-bold hover:underline">
                {delivery.driver?.user?.name ?? "Unnamed driver"}
              </Link>
            </li>
            <li className="text-on-surface-variant">{vehicleLabel(delivery.driver?.vehicleType)}</li>
            {delivery.driver?.user?.phone ? (
              <li>
                <a href={`tel:${delivery.driver.user.phone}`} className="text-primary hover:underline">{delivery.driver.user.phone}</a>
              </li>
            ) : null}
            {when(delivery.assignedAt) ? <li className="text-on-surface-variant">Offered {when(delivery.assignedAt)}</li> : null}
            {when(delivery.pickedUpAt) ? <li className="text-on-surface-variant">Collected {when(delivery.pickedUpAt)}</li> : null}
            {when(delivery.deliveredAt) ? <li className="text-on-surface-variant">Delivered {when(delivery.deliveredAt)}</li> : null}
            {delivery.failureReason ? <li className="text-error">Failed: {delivery.failureReason}</li> : null}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">Pick somebody below, or use the dispatch board.</p>
        )}

        {!delivery.driverId || canReassign(delivery) ? (
          <AssignDriver
            deliveryId={id}
            drivers={serialize(drivers)}
            currency={currency}
            reassign={Boolean(delivery.driverId)}
            canAssign={can(principal, delivery.driverId ? "deliveries.reassign" : "deliveries.assign", { branchId })}
          />
        ) : null}
      </Section>

      <Section title="Money">
        <dl className="grid gap-2 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Order total</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(delivery.order?.grandTotal, currency)}</dd>
          </div>
          {Number(delivery.codAmount) > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">To collect on delivery</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(delivery.codAmount, currency)}</dd>
            </div>
          ) : null}
          {Number(delivery.driverEarning) > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">The driver earns</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(delivery.driverEarning, currency)}</dd>
            </div>
          ) : null}
        </dl>
        {Number(delivery.codAmount) > 0 ? (
          <p className="text-body-md text-on-surface-variant">
            Cash collected on this job is the restaurant&rsquo;s money in the driver&rsquo;s bag until they hand it
            over. It is deducted from their payout if they have not.
          </p>
        ) : null}
      </Section>

      {delivery.recipientName ? (
        <Section title="Who took it" description="What the driver reported at the door.">
          <p className="text-body-md text-on-surface">Handed to {delivery.recipientName}.</p>
        </Section>
      ) : null}
    </div>
  );
}
