import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { accountBalances } from "@/server/services/journal.service";
import { accountOptions, branchNames } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_ORDER, accountTree, balanceReads, flattenAccounts } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Chart of accounts — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The chart of accounts, grouped the way a chart is read.
 *
 * Company data, not branch data: an account code means the same thing at
 * every outlet, so the list is not cut by branch. The *balances* beside each
 * one are, because they are made of entries — a manager at one outlet sees
 * their own outlet's figure against the company's account names, which is
 * the only combination that is both useful and theirs to see.
 */
export default async function AccountsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/accounts"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "accounts.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const showInactive = one(params.inactive) === "1";

  const [accounts, balances, { currency }] = await Promise.all([
    accountOptions({ includeInactive: true }),
    accountBalances({ scope: branchScope(principal, "accounts.read") }),
    getSiteIdentity(),
  ]);

  const visible = showInactive ? accounts : accounts.filter((account) => account.isActive);
  const balanceBy = Object.fromEntries(
    balances.map((row) => [
      row.accountId,
      row.normalBalance === "DEBIT"
        ? String(Number(row.debit) - Number(row.credit))
        : String(Number(row.credit) - Number(row.debit)),
    ]),
  );
  const names = await branchNames(visible.map((row) => row.branchId));

  const byType = ACCOUNT_TYPE_ORDER.map((type) => ({
    type,
    rows: flattenAccounts(accountTree(serialize(visible.filter((account) => account.type === type)))),
  })).filter((group) => group.rows.length);

  const canCreate = holdsCompanyWide(principal, "accounts.create");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Chart of accounts"
        description="Every account the books can post to. One chart for the whole company — a code means the same thing at every branch, which is what makes two branches comparable."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/accounts/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New account
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href={showInactive ? "/dashboard/accounts" : "/dashboard/accounts?inactive=1"}
          className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {showInactive ? "Hide inactive accounts" : "Show inactive accounts"}
        </Link>
      </div>

      {byType.length ? (
        byType.map((group) => (
          <section key={group.type} className="flex flex-col gap-3">
            <div>
              <h2 className="font-display text-headline-md text-on-surface">{ACCOUNT_TYPES[group.type].label}</h2>
              <p className="text-body-md text-on-surface-variant">{ACCOUNT_TYPES[group.type].note}</p>
            </div>

            <ul className="flex flex-col gap-1">
              {group.rows.map((account) => {
                const balance = balanceBy[account.id];
                const odd = balance ? balanceReads(account, balance) : { unusual: false };
                return (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-lowest px-4 py-3"
                    style={{ marginInlineStart: `${account.depth * 1.25}rem` }}
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link href={`/dashboard/accounts/${account.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {account.code}
                      </Link>
                      <span className="text-body-md text-on-surface">{account.name}</span>
                      {account.isSystem ? <Chip>Used by the posting rules</Chip> : null}
                      {account.isActive ? null : <Chip tone="bg-error-container text-on-error-container">Inactive</Chip>}
                      {account.branchId ? <Chip tone="bg-secondary-container text-on-secondary-container">{names[account.branchId] ?? "One branch"}</Chip> : null}
                    </span>
                    {balance ? (
                      <span className="shrink-0 text-right">
                        <span className="tabular-nums text-body-md text-on-surface">{formatMoney(balance, currency)}</span>
                        {odd.unusual ? <span className="block text-label-bold font-normal text-error">Unusual side</span> : null}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState icon={Landmark} title="No accounts">
          The chart is seeded when the system is set up. An empty one means nothing can post.
        </EmptyState>
      )}
    </div>
  );
}
