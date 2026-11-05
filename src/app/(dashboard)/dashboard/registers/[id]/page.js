import { notFound, redirect } from "next/navigation";
import { requireReachable } from "@/lib/api/page";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import CloseDrawer from "@/components/dashboard/finance/CloseDrawer";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSession } from "@/server/services/register.service";
import { assertRecordAccess } from "@/server/finance/access";
import { branchNames, userNames } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { MOVEMENT_TYPES, SESSION_STATES, cashVariance, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Register session — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One shift against one drawer.
 *
 * While the session is open the expected figure is shown here plainly,
 * because mid-shift it is a working number — it is what decides whether to
 * drop cash to the safe. It is withheld only at the moment of counting, in
 * the close form, where showing it would be telling the cashier the answer.
 */
export default async function RegisterSessionPage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/registers/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "cash_registers.read")) redirect("/dashboard");

  await requireReachable(assertRecordAccess(principal, "registerSession", id, "cash_registers.read"));

  const session = serialize(
    await requireReachable(getSession(id)));
  const state = SESSION_STATES[session.status] ?? { label: session.status, tone: "", note: "" };
  const [{ currency }, names, people] = await Promise.all([
    getSiteIdentity(),
    branchNames([session.branchId]),
    userNames([session.openedById, session.closedById, ...session.movements.map((row) => row.performedById)]),
  ]);

  const variance = cashVariance({ expected: session.expectedCash, counted: session.countedCash });
  const canClose = can(principal, "cash_registers.close", { branchId: session.branchId });
  // The count form below hides the expected figure until a number is typed, on
  // the grounds that a cashier shown the answer reconciles to the answer. That
  // only holds if the figure is not also printed in plain sight further up the
  // same page, so for the person who is about to count it, revealing it is a
  // deliberate act rather than the default.
  const hideExpected = session.status === "OPEN" && canClose;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={session.registerName}
        description={`${names[session.branchId] ?? "This branch"} · ${state.note}`}
        back={{ href: "/dashboard/registers", label: "Registers" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">The money</h2>
          <dl className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body-md text-on-surface-variant">Opening float</dt>
              <dd className="tabular-nums text-body-md text-on-surface">{formatMoney(session.openingFloat, currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body-md text-on-surface-variant">
                {session.status === "OPEN" ? "Should be in the drawer now" : "System expected"}
              </dt>
              <dd className="tabular-nums text-body-md text-on-surface">
                {hideExpected ? (
                  <details className="text-right">
                    <summary className="cursor-pointer list-none text-label-bold text-on-surface-variant underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      Hidden until you count
                    </summary>
                    <p className="mt-1 tabular-nums text-on-surface">{formatMoney(session.expectedCash, currency)}</p>
                  </details>
                ) : (
                  formatMoney(session.expectedCash, currency)
                )}
              </dd>
            </div>
            {session.countedCash != null ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-body-md text-on-surface-variant">Counted</dt>
                  <dd className="tabular-nums text-body-md text-on-surface">{formatMoney(session.countedCash, currency)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className={`text-label-bold ${variance.tone}`}>{variance.label}</dt>
                  <dd className={`tabular-nums text-label-bold ${variance.tone}`}>
                    {variance.direction === "square" ? "" : formatMoney(variance.amount, currency)}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          {session.notes ? <p className="text-body-md text-on-surface-variant">{session.notes}</p> : null}
        </section>

        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">The shift</h2>
          <dl className="flex flex-col gap-2">
            {[
              ["Opened", `${timeLabel(session.openedAt)}${people[session.openedById] ? ` by ${people[session.openedById]}` : ""}`],
              ["Closed", session.closedAt ? `${timeLabel(session.closedAt)}${people[session.closedById] ? ` by ${people[session.closedById]}` : ""}` : "Still open"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-bold text-on-surface-variant">{label}</dt>
                <dd className="text-body-md text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">By kind</h2>
          {Object.keys(session.totalsByType ?? {}).length ? (
            <dl className="flex flex-col gap-2">
              {Object.entries(session.totalsByType).map(([type, amount]) => (
                <div key={type} className="flex items-baseline justify-between gap-3">
                  <dt className="text-body-md text-on-surface-variant">{MOVEMENT_TYPES[type]?.label ?? type}</dt>
                  <dd className="tabular-nums text-body-md text-on-surface">{formatMoney(amount, currency)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing has moved through this drawer yet.</p>
          )}
        </section>
      </div>

      <CloseDrawer
        session={session}
        expected={session.expectedCash}
        currency={currency}
        canClose={canClose}
        canReconcile={can(principal, "cash_registers.reconcile", { branchId: session.branchId })}
        canRecordMovement={can(principal, "cash_registers.record_movement", { branchId: session.branchId })}
      />

      {session.movements.length ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Everything that moved</h2>
          <ul className="flex flex-col gap-2">
            {session.movements.map((movement) => {
              const out = Number(movement.amount) < 0;
              return (
                <li key={movement.id} className="flex flex-wrap items-baseline justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <span className="min-w-0">
                    <span className="text-body-md text-on-surface">{MOVEMENT_TYPES[movement.type]?.label ?? movement.type}</span>
                    <span className="block text-label-bold font-normal text-on-surface-variant">
                      {timeLabel(movement.createdAt)}
                      {people[movement.performedById] ? ` · ${people[movement.performedById]}` : ""}
                      {movement.reason ? ` · ${movement.reason}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 tabular-nums text-body-md ${out ? "text-error" : "text-on-surface"}`}>
                    {out ? "−" : "+"}
                    {formatMoney(String(movement.amount).replace("-", ""), currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
