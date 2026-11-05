import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listPayments } from "@/server/services/payment.service";
import { paymentCounts, scopedBranches, waitingOnSomeone } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { PAYMENT_FILTERS, PAYMENT_METHODS, PAYMENT_STATES, methodLabel, providerNote, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payments — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Money in.
 *
 * The tile that earns its place is **to capture**: a card authorisation holds
 * the money without taking it, and an authorisation nobody captures simply
 * expires. The order was made, the food went out, and the payment quietly
 * never happened. Nothing else on this page surfaces that, because every
 * other state is either finished or visibly broken.
 */
export default async function PaymentsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/payments"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "payments.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "payments.read");

  const [counts, branches, { currency }, waiting] = await Promise.all([
    paymentCounts(principal),
    scopedBranches(principal, "payments.read"),
    getSiteIdentity(),
    waitingOnSomeone(principal),
  ]);

  const requested = one(params.status);
  const status = PAYMENT_FILTERS.some((row) => row.value === requested) ? requested : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const method = PAYMENT_METHODS[one(params.method)] ? one(params.method) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listPayments({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(method ? { method } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listPayments({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const payments = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, method, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/payments?${text}` : "/dashboard/payments";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Every attempt to take money for an order, however it was taken. A payment and an order are not the same thing — an order can have several, and one can fail without the order being wrong."
      />

      {waiting.capture?.count ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="Waiting to be captured"
            value={formatMoney(waiting.capture.amount, currency)}
            note={`${waiting.capture.count} card ${waiting.capture.count === 1 ? "authorisation" : "authorisations"} reserved but not taken. They expire on their own.`}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {PAYMENT_FILTERS.map((tab) => {
          const active = tab.value === status;
          const count = tab.value ? (counts[tab.value] ?? 0) : Object.values(counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.value, cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
      </div>

      <ListFilters
        id="payments"
        hidden={{ status: status || null }}
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
            name: "method",
            label: "Method",
            value: method,
            options: [{ value: "", label: "Any method" }, ...Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))],
          },
        ]}
      />

      {payments.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {payments.map((payment) => {
              const state = PAYMENT_STATES[payment.status] ?? { label: payment.status, tone: "" };
              return (
                <li key={payment.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/payments/${payment.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {payment.order?.orderNumber ?? "Payment"}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {methodLabel(payment.method)}
                      {payment.cardLast4 ? ` ····${payment.cardLast4}` : ""}
                      {providerNote(payment.method, payment.provider) ? ` · ${providerNote(payment.method, payment.provider)}` : ""}
                      {branches.length > 1 ? ` · ${branchName[payment.branchId] ?? "Another branch"}` : ""}
                      {" · "}
                      {timeLabel(payment.createdAt)}
                    </p>
                    {payment.failureMessage ? (
                      <p className="mt-1 text-body-md text-error">{payment.failureMessage}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-body-md text-on-surface">{formatMoney(payment.amount, payment.currency ?? currency)}</p>
                    {Number(payment.refundedAmount) > 0 ? (
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        {formatMoney(payment.refundedAmount, payment.currency ?? currency)} refunded
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={CreditCard} title={status ? "Nothing in this state" : "No payments yet"}>
          {status ? "Try another tab." : "Payments appear here as orders are paid for, at the counter or online."}
        </EmptyState>
      )}
    </div>
  );
}
