import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import DriverForm from "@/components/dashboard/delivery/DriverForm";
import DriverStatusControl from "@/components/dashboard/delivery/DriverStatusControl";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getDriver } from "@/server/services/driver.service";
import { driverQueue } from "@/server/services/delivery.service";
import { driverEarningsSummary } from "@/server/services/driver-payout.service";
import { actionableBranches } from "@/server/content/delivery-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { DELIVERY_STATES, DRIVER_STATES, availability, lastSeen, licenceState, vehicleLabel } from "@/lib/delivery";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Driver — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One driver: whether they can be given work, what they are carrying, and
 * what they are owed.
 *
 * The cash figure is given its own words rather than a label, because
 * "cash in hand" reads like a balance in their favour and it is the opposite:
 * it is the restaurant's money that has not come back yet, and it is deducted
 * from the next payout.
 */
export default async function DriverPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/drivers/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "drivers.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getDriver(id));
  if (!raw || !inScope(branchScope(principal, "drivers.read"), raw.branchId)) notFound();

  const driver = serialize(raw);
  const branchId = driver.branchId;
  const canEdit = can(principal, "drivers.update", { branchId });

  const [{ currency }, queue, earnings, branches] = await Promise.all([
    getSiteIdentity(),
    hasPermission(permissions, "deliveries.read") ? driverQueue({ driverId: id }) : [],
    hasPermission(permissions, "driver_payouts.read") ? driverEarningsSummary({ driverId: id }).catch(() => null) : null,
    canEdit ? actionableBranches(principal, "drivers.update") : [],
  ]);

  const state = DRIVER_STATES[driver.status] ?? { label: driver.status, tone: "" };
  const room = availability(driver);
  const seen = lastSeen(driver.lastLocationAt);
  const licence = licenceState(driver.licenseExpiry);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={driver.user?.name ?? "Driver"}
        description={`${vehicleLabel(driver.vehicleType)}${driver.vehicleNumber ? ` · ${driver.vehicleNumber}` : ""} · ${room.canTake ? `${room.active} of ${room.max} jobs` : room.reason}`}
        back={{ href: "/dashboard/drivers", label: "Drivers" }}
        actions={
          <>
            <Chip tone={state.tone}>{state.label}</Chip>
            {driver.isActive ? null : <Chip>No longer riding</Chip>}
          </>
        }
      />

      {licence ? (
        <p className={`rounded-card px-5 py-4 text-body-md ${licence.tone}`}>
          {licence.label}. A rider on the road without a valid licence is the restaurant&rsquo;s liability too.
        </p>
      ) : null}

      <Section title="Right now">
        <ul className="flex flex-col gap-1 text-body-md text-on-surface">
          <li>
            Position <span className={seen.tone}>{seen.label.toLowerCase()}</span>
            {seen.stale ? " — treat it as a guess, not a location." : ""}
          </li>
          {driver.user?.phone ? (
            <li>
              <a href={`tel:${driver.user.phone}`} className="text-primary hover:underline">{driver.user.phone}</a>
            </li>
          ) : null}
        </ul>
        <DriverStatusControl driver={driver} canUpdate={canEdit} />
      </Section>

      {hasPermission(permissions, "deliveries.read") ? (
        <Section title="What they are carrying">
          {queue.length ? (
            <ul className="flex flex-col gap-2">
              {serialize(queue).map((delivery) => {
                const deliveryState = DELIVERY_STATES[delivery.status] ?? { label: delivery.status, tone: "" };
                return (
                  <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/deliveries/${delivery.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {delivery.order?.orderNumber ?? "Order"}
                      </Link>
                      <Chip tone={deliveryState.tone}>{deliveryState.label}</Chip>
                    </span>
                    <span className="text-body-md text-on-surface-variant">
                      {delivery.order?.addressSnapshot?.city ?? "No address"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing in their bag.</p>
          )}
        </Section>
      ) : null}

      {earnings ? (
        <Section title="What they are owed">
          <dl className="grid gap-2 text-body-md">
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Deliveries not yet in a payout</dt>
              <dd className="tabular-nums text-on-surface">{earnings.unpaidDeliveries}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Earnings</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(earnings.earnings, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Tips</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(earnings.tips, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Our cash they are holding</dt>
              <dd className="tabular-nums text-on-surface">−{formatMoney(earnings.cashInHand, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
              <dt className="text-label-bold text-on-surface">Would be paid</dt>
              <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(earnings.estimatedNet, currency)}</dd>
            </div>
          </dl>
          <p className="text-body-md text-on-surface-variant">
            An estimate until a payout is worked out. Cash collected on delivery is the restaurant&rsquo;s money until
            it is handed over, so it comes off what they are paid.
          </p>
          {hasPermission(permissions, "driver_payouts.read") ? (
            <Link href={`/dashboard/driver-payouts?driver=${id}`} className="w-fit text-label-bold text-primary hover:underline">
              Their payouts
            </Link>
          ) : null}
        </Section>
      ) : null}

      {canEdit ? (
        <Section title="Their details">
          <DriverForm accounts={[]} branches={serialize(branches)} driver={driver} />
        </Section>
      ) : null}
    </div>
  );
}
