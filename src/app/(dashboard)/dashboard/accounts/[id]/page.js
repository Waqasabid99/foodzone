import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import AccountForm from "@/components/dashboard/finance/AccountForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { accountLedger } from "@/server/services/account.service";
import { accountOptions, branchNames, scopedBranches } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { ACCOUNT_TYPES, balanceReads, dateLabel, sourceLabel, toDateInput } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Account — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One account, read as a statement.
 *
 * The running balance down the right is the whole point: a list of debits and
 * credits is arithmetic homework, and the same list with a running figure is
 * something you can scan for the line where it went wrong.
 *
 * The movements are cut to the reader's branches, exactly as the statements
 * are. Without that, a manager who can only see their own outlet's profit and
 * loss could open any account behind a figure on it and read every branch's
 * entries — the same disclosure by a longer route.
 */
export default async function AccountPage({ params, searchParams }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/accounts/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "accounts.read")) redirect("/dashboard");

  const query = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const from = one(query.from) ?? "";
  const to = one(query.to) ?? "";

  const ledger = serialize(
    await requireReachable(accountLedger({
      id,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit: 200,
      scope: branchScope(principal, "accounts.read"),
    })),
  );

  const account = ledger.account;
  const [{ currency }, parents, branches, names] = await Promise.all([
    getSiteIdentity(),
    accountOptions(),
    scopedBranches(principal, "accounts.update"),
    branchNames([account.branchId]),
  ]);

  const odd = balanceReads(account, ledger.closingBalance);
  const posted = ledger.movements.length > 0 || Number(ledger.openingBalance) !== 0;
  const mayEdit = account.branchId
    ? hasPermission(permissions, "accounts.update")
    : holdsCompanyWide(principal, "accounts.update");
  const mayDeactivate = account.branchId
    ? hasPermission(permissions, "accounts.deactivate")
    : holdsCompanyWide(principal, "accounts.deactivate");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${account.code} — ${account.name}`}
        description={`${ACCOUNT_TYPES[account.type]?.label ?? account.type} · normally a ${account.normalBalance.toLowerCase()} balance${account.branchId ? ` · ${names[account.branchId] ?? "one branch"}` : ""}`}
        back={{ href: "/dashboard/accounts", label: "Chart of accounts" }}
        actions={
          <>
            {account.isSystem ? <Chip>Used by the posting rules</Chip> : null}
            {account.isActive ? null : <Chip tone="bg-error-container text-on-error-container">Inactive</Chip>}
          </>
        }
      />

      {odd.unusual ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          {odd.label}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Opening", ledger.openingBalance],
          ["Debits", ledger.debit],
          ["Credits", ledger.credit],
          ["Closing", ledger.closingBalance],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card bg-surface-container-lowest p-5">
            <p className="text-label-bold text-on-surface-variant">{label}</p>
            <p className="tabular-nums font-display text-headline-md text-on-surface">{formatMoney(value, currency)}</p>
          </div>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ledger-from" className="text-label-bold text-on-surface">From</label>
          <input id="ledger-from" name="from" type="date" defaultValue={from} className="min-h-11 rounded-field bg-surface-container-low px-3 text-body-md text-on-surface" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ledger-to" className="text-label-bold text-on-surface">To</label>
          <input id="ledger-to" name="to" type="date" defaultValue={to || toDateInput(new Date())} className="min-h-11 rounded-field bg-surface-container-low px-3 text-body-md text-on-surface" />
        </div>
        <button type="submit" className="min-h-11 rounded-field bg-surface-container-high px-5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Show
        </button>
      </form>

      {ledger.movements.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-headline-md text-on-surface">Movements</h2>
          <ul className="flex flex-col gap-2">
            {ledger.movements.map((movement) => (
              <li key={movement.lineId} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/journal/${movement.entryId}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {movement.entryNumber}
                    </Link>
                    <Chip>{sourceLabel(movement.source)}</Chip>
                  </p>
                  <p className="mt-1 text-body-md text-on-surface-variant">
                    {dateLabel(movement.entryDate)}
                    {movement.description ? ` · ${movement.description}` : movement.memo ? ` · ${movement.memo}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-6 text-right">
                  <span className="tabular-nums text-body-md text-on-surface">
                    {Number(movement.debit) ? formatMoney(movement.debit, currency) : ""}
                  </span>
                  <span className="tabular-nums text-body-md text-on-surface">
                    {Number(movement.credit) ? formatMoney(movement.credit, currency) : ""}
                  </span>
                  <span className="tabular-nums text-label-bold text-on-surface">{formatMoney(movement.balance, currency)}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-body-md text-on-surface-variant">
            Debit, credit, then the running balance. Only posted entries appear — a draft is somebody&rsquo;s
            unfinished work and is not in the books.
          </p>
        </section>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
          Nothing has posted to this account in the range shown.
        </p>
      )}

      {mayEdit ? (
        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Edit</h2>
          <AccountForm
            account={account}
            parents={serialize(parents.filter((row) => row.id !== account.id))}
            branches={serialize(branches)}
            locked={posted}
          />
        </section>
      ) : null}

      {mayDeactivate && !account.isSystem ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">
            {account.isActive ? "Stop using this account" : "Use this account again"}
          </h2>
          <ActionButton
            method="put"
            endpoint={`/admin/accounts/${account.id}/active`}
            body={{ isActive: !account.isActive }}
            confirm={account.isActive ? "Deactivate this account? Nothing new can post to it." : null}
            success={account.isActive ? "Deactivated." : "Reactivated."}
            tone={account.isActive ? "danger" : "primary"}
          >
            {account.isActive ? "Deactivate" : "Reactivate"}
          </ActionButton>
          <p className="text-body-md text-on-surface-variant">
            Deactivation, never deletion — every line already posted points at this account, and always will.
          </p>
        </section>
      ) : null}
    </div>
  );
}
