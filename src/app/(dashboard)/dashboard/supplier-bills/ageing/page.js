import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { payablesAgeing } from "@/server/services/supplier-bill.service";
import { scopedBranches } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { AGEING_BUCKETS, dateLabel, dayKey } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payables ageing — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * What is owed, to whom, and how late.
 *
 * `As of` is a real control rather than always "today", because an ageing run
 * at a month end and one run this afternoon give different answers for the
 * same invoices — and quoting one as the other is how a supplier gets chased
 * for something that was not yet due.
 *
 * The per-supplier roll-up is first, because that is how a payment run is
 * actually decided: not invoice by invoice, but "who are we paying this week".
 */
export default async function PayablesAgeingPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/supplier-bills/ageing"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "supplier_bills.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branches = await scopedBranches(principal, "supplier_bills.read");
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const asOfKey = /^\d{4}-\d{2}-\d{2}$/.test(one(params.asOf) ?? "") ? one(params.asOf) : dayKey();

  const [{ currency }, raw] = await Promise.all([
    getSiteIdentity(),
    payablesAgeing({
      scope: branchScope(principal, "supplier_bills.read"),
      ...(branch ? { branchId: branch } : {}),
      asOf: new Date(`${asOfKey}T23:59:59.999Z`),
    }),
  ]);
  const ageing = serialize(raw);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Payables ageing"
        description="Everything approved and not yet settled, sorted by how late it is."
        back={{ href: "/dashboard/supplier-bills", label: "Supplier bills" }}
      />

      <ListFilters
        id="ageing"
        fields={[
          { type: "date", name: "asOf", label: "As of", value: asOfKey },
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
        ]}
        submitLabel="Re-age"
      />

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {AGEING_BUCKETS.map((bucket) => (
          <div key={bucket.key} className="flex flex-col gap-1 rounded-card bg-surface-container-lowest p-4">
            <dt className="text-label-bold font-normal text-on-surface-variant">{bucket.label}</dt>
            <dd className={`font-display text-headline-md tabular-nums ${bucket.tone}`}>
              {formatMoney(ageing.buckets[bucket.key] ?? 0, currency)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface">
        <strong className="tabular-nums">{formatMoney(ageing.total, currency)}</strong> owed in total as of{" "}
        {dateLabel(asOfKey)}.
      </p>

      <Section title="By supplier" description="How a payment run is actually decided.">
        {ageing.suppliers.length ? (
          <ul className="flex flex-col gap-2">
            {ageing.suppliers.map((row) => (
              <li key={row.supplierId} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <Link href={`/dashboard/suppliers/${row.supplierId}`} className="text-label-bold text-on-surface hover:underline">
                  {row.supplier}
                </Link>
                <span className="text-body-md text-on-surface-variant">
                  {row.bills} {row.bills === 1 ? "invoice" : "invoices"} ·{" "}
                  <span className="tabular-nums text-on-surface">{formatMoney(row.total, currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">Nothing outstanding. Every approved bill has been settled.</p>
        )}
      </Section>

      {ageing.rows.length ? (
        <Section title="Invoice by invoice" description="Oldest due date first.">
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-xl border-collapse text-left text-body-md">
              <caption className="sr-only">Outstanding invoices</caption>
              <thead>
                <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                  <th scope="col" className="py-2 pr-4 font-normal">Bill</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Supplier</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Due</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Age</th>
                  <th scope="col" className="py-2 text-right font-normal">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {ageing.rows.map((row) => {
                  const bucket = AGEING_BUCKETS.find((entry) => entry.key === row.bucket);
                  return (
                    <tr key={row.billId} className="border-b border-outline-variant">
                      <th scope="row" className="py-3 pr-4 text-left font-normal">
                        <Link href={`/dashboard/supplier-bills/${row.billId}`} className="font-mono text-label-bold text-on-surface hover:underline">
                          {row.billNumber}
                        </Link>
                      </th>
                      <td className="py-3 pr-4 text-on-surface">{row.supplier}</td>
                      <td className="py-3 pr-4 text-on-surface-variant">{dateLabel(row.dueDate)}</td>
                      <td className={`py-3 pr-4 ${bucket?.tone ?? "text-on-surface-variant"}`}>{bucket?.label ?? row.bucket}</td>
                      <td className="py-3 text-right tabular-nums text-on-surface">{formatMoney(row.outstanding, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
