import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { invoiceTotals, listInvoices } from "@/server/services/invoice-admin.service";
import { branchNames, scopedBranches } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Invoices — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Invoices that have gone out.
 *
 * Read-only, and deliberately so. Issuing an invoice and voiding one both
 * happen on the order they belong to, because both are things you do to an
 * order — this page is for the question an order screen cannot answer:
 * *which* invoices went out, and were any of them voided.
 *
 * A voided invoice is still listed rather than hidden. The number was issued
 * and may be sitting in a customer's records; a gap in a sequence is exactly
 * the thing an auditor asks about, and "it is not in the system" is the worst
 * available answer.
 */
export default async function InvoicesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/invoices"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "invoices.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "invoices.read");

  const branches = await scopedBranches(principal, "invoices.read");
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const search = (one(params.q) ?? "").trim();
  const show = one(params.show) === "void" ? "void" : one(params.show) === "all" ? "all" : "live";
  const from = one(params.from) ?? "";
  const to = one(params.to) ?? "";
  const cursor = one(params.cursor) || undefined;

  const filters = {
    ...(branch ? { branchId: branch } : {}),
    ...(search ? { search } : {}),
    ...(show === "live" ? { voided: false } : show === "void" ? { voided: true } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    scope,
  };

  const [page, totals, { currency, timeZone }] = await Promise.all([
    listInvoices({ ...filters, limit: PAGE_SIZE, cursor }).catch((error) => {
      if (cursor) return listInvoices({ ...filters, limit: PAGE_SIZE });
      throw error;
    }),
    invoiceTotals({ ...filters, voided: undefined }),
    getSiteIdentity(),
  ]);

  const invoices = serialize(page.items);
  const names = await branchNames(invoices.map((invoice) => invoice.order?.branchId));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { branch, q: search, show: show === "live" ? "" : show, from, to, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/invoices?${text}` : "/dashboard/invoices";
  };

  const TABS = [
    { value: "live", label: "Issued" },
    { value: "void", label: "Voided" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Tax documents issued against orders. An invoice is issued and voided from the order it belongs to; this is where they can be found afterwards."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Issued" value={String(totals.issued)} note="Live invoices in the range shown." />
        <StatTile label="Invoiced" value={formatMoney(totals.total, currency)} note={`Including ${formatMoney(totals.tax, currency)} of tax.`} />
        {totals.voided ? <StatTile label="Voided" value={String(totals.voided)} note="Issued and then cancelled. The numbers are still used." tone="inverse" /> : null}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={href({ show: tab.value === "live" ? "" : tab.value, cursor: "" })}
            aria-current={show === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${show === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <ListFilters
        id="invoices"
        hidden={{ show: show === "live" ? null : show }}
        fields={[
          { type: "search", name: "q", label: "Find", value: search, placeholder: "Invoice or order number, or a billing name" },
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
          { type: "date", name: "from", label: "From", value: from },
          { type: "date", name: "to", label: "To", value: to },
        ]}
      />

      {invoices.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-label-bold text-on-surface">{invoice.invoiceNumber}</span>
                    {invoice.isVoid ? <Chip tone="bg-error-container text-on-error-container">Voided</Chip> : null}
                  </p>
                  <p className="mt-1 text-body-md text-on-surface">
                    {invoice.billingName ?? invoice.order?.user?.name ?? invoice.order?.guestName ?? "No billing name"}
                    {invoice.billingTaxId ? ` · ${invoice.billingTaxId}` : ""}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    {invoice.order ? (
                      <Link href={`/dashboard/orders/${invoice.order.id}`} className="font-mono hover:underline">
                        {invoice.order.orderNumber}
                      </Link>
                    ) : (
                      "Order gone"
                    )}
                    {branches.length > 1 ? ` · ${names[invoice.order?.branchId] ?? "Another branch"}` : ""}
                    {" · issued "}
                    {dateLabel(invoice.issuedAt, timeZone)}
                  </p>
                  {invoice.isVoid && invoice.voidReason ? (
                    <p className="mt-1 text-body-md text-error">{invoice.voidReason}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="tabular-nums text-body-md text-on-surface">{formatMoney(invoice.totalAmount, currency)}</p>
                  <p className="text-label-bold font-normal text-on-surface-variant">
                    {formatMoney(invoice.taxAmount, currency)} tax
                  </p>
                </div>
              </li>
            ))}
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
        <EmptyState icon={Receipt} title={search || from || to ? "Nothing matches" : "No invoices issued"}>
          {search || from || to
            ? "Try a wider range."
            : "An invoice is issued from an order, usually because a customer asked for one with their company details on it."}
        </EmptyState>
      )}
    </div>
  );
}
