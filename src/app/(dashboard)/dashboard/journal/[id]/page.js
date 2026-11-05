import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getJournalEntry } from "@/server/services/journal.service";
import { assertRecordAccess } from "@/server/finance/access";
import { branchNames, userNames } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { JOURNAL_STATES, PERIOD_STATES, dateLabel, entryBalance, sourceLabel, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Journal entry — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where to look for whatever caused an entry. */
function sourceHref(entry) {
  if (entry.orderId) return { href: `/dashboard/orders/${entry.orderId}`, label: "the order" };
  if (entry.paymentId) return { href: `/dashboard/payments/${entry.paymentId}`, label: "the payment" };
  if (entry.goodsReceiptId) return { href: `/dashboard/goods-receipts/${entry.goodsReceiptId}`, label: "the goods receipt" };
  if (entry.supplierBillId) return { href: `/dashboard/supplier-bills/${entry.supplierBillId}`, label: "the supplier bill" };
  if (entry.expenseId) return { href: `/dashboard/expenses/${entry.expenseId}`, label: "the expense" };
  if (entry.productionOrderId) return { href: `/dashboard/production/${entry.productionOrderId}`, label: "the production run" };
  if (entry.driverPayoutId) return { href: `/dashboard/driver-payouts/${entry.driverPayoutId}`, label: "the driver payout" };
  return null;
}

/**
 * One entry, line by line.
 *
 * A posted entry is never edited — only reversed — and the page says why
 * rather than simply hiding the buttons. An edited posting would change
 * figures in a month that may already have been reported, with nothing left
 * to show that it happened. A reversal leaves both halves visible, which is
 * the entire point of keeping books this way.
 */
export default async function JournalEntryPage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/journal/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "journal_entries.read")) redirect("/dashboard");

  await requireReachable(assertRecordAccess(principal, "journalEntry", id, "journal_entries.read"));

  const entry = serialize(
    await requireReachable(getJournalEntry(id)));
  const state = JOURNAL_STATES[entry.status] ?? { label: entry.status, tone: "", note: "" };
  const [{ currency }, names, people] = await Promise.all([
    getSiteIdentity(),
    branchNames([entry.branchId]),
    userNames([entry.createdById, entry.postedById]),
  ]);

  const balance = entryBalance(entry.lines.map((line) => ({ debit: line.debit, credit: line.credit })));
  const origin = sourceHref(entry);
  const periodShut = entry.period && entry.period.status !== "OPEN";

  const canPost = can(principal, "journal_entries.post", { branchId: entry.branchId ?? undefined });
  const canVoid = can(principal, "journal_entries.void", { branchId: entry.branchId ?? undefined });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={entry.entryNumber}
        description={state.note}
        back={{ href: "/dashboard/journal", label: "Journal" }}
        actions={
          <>
            <Chip tone={state.tone}>{state.label}</Chip>
            <Chip>{sourceLabel(entry.source)}</Chip>
          </>
        }
      />

      {!balance.balanced && entry.status === "POSTED" ? (
        <p role="status" className="rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          This posted entry does not balance. That should be impossible — something wrote to the ledger without going
          through the posting rules, and every report that includes this entry is wrong.
        </p>
      ) : null}

      {entry.reversalOfId ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          This entry exists to undo another one.{" "}
          <Link href={`/dashboard/journal/${entry.reversalOfId}`} className="underline">
            See the original
          </Link>
          .
        </p>
      ) : null}

      {entry.reversedBy ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          This entry has been reversed by{" "}
          <Link href={`/dashboard/journal/${entry.reversedBy.id}`} className="underline">
            {entry.reversedBy.entryNumber}
          </Link>
          , so its effect has been cancelled out. Both halves stay in the books on purpose.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5 lg:col-span-2">
          <h2 className="font-display text-headline-md text-on-surface">What this is</h2>
          <p className="text-body-md text-on-surface">{entry.memo ?? "No memo was written."}</p>
          {origin ? (
            <p className="text-body-md text-on-surface-variant">
              Caused by{" "}
              <Link href={origin.href} className="text-primary hover:underline">
                {origin.label}
              </Link>
              .
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">When and where</h2>
          <dl className="flex flex-col gap-2">
            {[
              ["Dated", dateLabel(entry.entryDate)],
              ["Branch", entry.branchId ? (names[entry.branchId] ?? "Another branch") : "The company as a whole"],
              ["Period", entry.period ? `${entry.period.name} — ${PERIOD_STATES[entry.period.status]?.label ?? entry.period.status}` : "Not in a period"],
              ["Written by", people[entry.createdById] ?? "The system"],
              ["Posted", entry.postedAt ? `${timeLabel(entry.postedAt)}${people[entry.postedById] ? ` by ${people[entry.postedById]}` : ""}` : "Not posted"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-bold text-on-surface-variant">{label}</dt>
                <dd className="text-body-md text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-headline-md text-on-surface">Lines</h2>
        <ul className="flex flex-col gap-2">
          {entry.lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-4">
              <div className="min-w-0 flex-1">
                <p>
                  <Link href={`/dashboard/accounts/${line.accountId}`} className="text-label-bold text-on-surface hover:underline">
                    <span className="font-mono">{line.account?.code}</span> {line.account?.name}
                  </Link>
                </p>
                {line.description ? <p className="text-body-md text-on-surface-variant">{line.description}</p> : null}
                {line.partyType ? (
                  <p className="text-label-bold font-normal text-on-surface-variant">
                    {line.partyType.toLowerCase()} {line.partyId}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-6 text-right">
                <span className="tabular-nums text-body-md text-on-surface">
                  {Number(line.debit) ? formatMoney(line.debit, currency) : ""}
                </span>
                <span className="tabular-nums text-body-md text-on-surface">
                  {Number(line.credit) ? formatMoney(line.credit, currency) : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className={`flex flex-wrap items-baseline justify-between gap-3 rounded-card p-5 ${balance.balanced ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"}`}>
          <span className="text-label-bold">{balance.balanced ? "Debits and credits agree" : "These do not balance"}</span>
          <span className="flex gap-6">
            <span className="tabular-nums">{formatMoney(entry.totalDebit, currency)}</span>
            <span className="tabular-nums">{formatMoney(entry.totalCredit, currency)}</span>
          </span>
        </div>
      </section>

      {entry.status === "DRAFT" || entry.status === "POSTED" ? (
        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">What you can do</h2>

          {periodShut ? (
            <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
              {entry.period.name} is {PERIOD_STATES[entry.period.status]?.label.toLowerCase()}, so nothing can post
              into it. Reopen the period first, or date the correction into an open one.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {entry.status === "DRAFT" && canPost ? (
              <ActionButton
                endpoint={`/admin/journal-entries/${entry.id}/post`}
                confirm="Post this into the books? It can be reversed afterwards, never edited."
                success="Posted."
                tone="primary"
              >
                Post it
              </ActionButton>
            ) : null}

            {entry.status === "DRAFT" && canVoid ? (
              <ActionButton
                endpoint={`/admin/journal-entries/${entry.id}/void`}
                confirm="Discard this draft?"
                success="Voided."
                tone="danger"
              >
                Discard the draft
              </ActionButton>
            ) : null}

            {entry.status === "POSTED" && !entry.reversedBy && canVoid ? (
              <ActionButton
                endpoint={`/admin/journal-entries/${entry.id}/reverse`}
                confirm="Write a reversing entry? Both this one and its reversal stay in the books."
                success="Reversed."
                tone="danger"
              >
                Reverse it
              </ActionButton>
            ) : null}
          </div>

          {entry.status === "POSTED" ? (
            <p className="text-body-md text-on-surface-variant">
              A posted entry is never edited. Correcting it writes a second, opposite entry, so both halves stay
              visible — which is what makes a ledger auditable rather than merely current.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
