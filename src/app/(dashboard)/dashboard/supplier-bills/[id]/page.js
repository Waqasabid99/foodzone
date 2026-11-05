import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import BillActions from "@/components/dashboard/purchasing/BillActions";
import BillPaymentForm from "@/components/dashboard/purchasing/BillPaymentForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getSupplierBill } from "@/server/services/supplier-bill.service";
import { paymentAccounts, userNames } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { BILL_STAGE_HINT, BILL_STATES, PAYMENT_METHODS, billPayable, dateLabel, dueState, outstandingOf } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Supplier bill — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One invoice: what it is for, what is left on it, and what has been paid.
 *
 * The payments list is kept beside the total on purpose. "Part paid" with no
 * visible history is the state in which a second payment gets made for the
 * same amount, and an overpaid supplier is far harder to unwind than an unpaid
 * one.
 */
export default async function SupplierBillPage({ params }) {
  const { timeZone } = await getSiteIdentity();
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/supplier-bills/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "supplier_bills.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getSupplierBill(id));
  if (!raw || !inScope(branchScope(principal, "supplier_bills.read"), raw.branchId)) notFound();

  const bill = serialize(raw);
  const branchId = bill.branchId;
  const canPay = billPayable(bill.status) && can(principal, "supplier_bills.record_payment", { branchId });
  const [names, accounts] = await Promise.all([userNames([bill.approvedById]), canPay ? paymentAccounts() : []]);

  const currency = bill.currency ?? "PKR";
  const owed = outstandingOf(bill);
  const due = dueState(bill);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={bill.billNumber}
        description={`${bill.supplier.name}${bill.supplierInvoiceNumber ? ` · their invoice ${bill.supplierInvoiceNumber}` : ""} · dated ${dateLabel(bill.billDate)}`}
        back={{ href: "/dashboard/supplier-bills", label: "Supplier bills" }}
        actions={<Chip tone={BILL_STATES[bill.status]?.tone}>{BILL_STATES[bill.status]?.label ?? bill.status}</Chip>}
      />

      <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
        {BILL_STAGE_HINT[bill.status]}
      </p>

      <BillActions
        bill={bill}
        currency={currency}
        canSubmit={can(principal, "supplier_bills.create", { branchId })}
        canApprove={can(principal, "supplier_bills.approve", { branchId })}
      />

      <Section title="What it comes to">
        <dl className="grid gap-2 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Goods</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(bill.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tax</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(bill.taxTotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Invoice total</dt>
            <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(bill.grandTotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Paid so far</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(bill.paidAmount, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Still owed</dt>
            <dd className={`text-label-bold tabular-nums ${Number(owed) > 0 ? due.tone : "text-on-surface-variant"}`}>
              {formatMoney(owed, currency)}
            </dd>
          </div>
        </dl>

        <p className={`text-body-md ${due.tone}`}>
          {bill.dueDate ? `Due ${dateLabel(bill.dueDate)} — ${due.label.toLowerCase()}.` : "No due date was set."}
        </p>

        <ul className="flex flex-col gap-1 text-body-md text-on-surface-variant">
          {bill.goodsReceipt ? (
            <li>
              Raised from{" "}
              <Link href={`/dashboard/goods-receipts/${bill.goodsReceipt.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                {bill.goodsReceipt.grnNumber}
              </Link>
              , delivered {dateLabel(bill.goodsReceipt.receivedAt, timeZone)}.
            </li>
          ) : (
            <li>Not linked to a delivery — typed in by hand.</li>
          )}
          {names[bill.approvedById] ? <li>Approved by {names[bill.approvedById]}.</li> : null}
          {bill.notes ? <li>“{bill.notes}”</li> : null}
        </ul>
      </Section>

      <Section title="Payments">
        {bill.payments.length ? (
          <ul className="flex flex-col gap-2">
            {bill.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <span className="text-body-md text-on-surface">
                  {dateLabel(payment.paidAt, timeZone)}
                  <span className="text-on-surface-variant">
                    {payment.method ? ` · ${PAYMENT_METHODS[payment.method] ?? payment.method}` : ""}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </span>
                </span>
                <span className="tabular-nums text-body-md text-on-surface">{formatMoney(payment.amount, currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">Nothing paid against this yet.</p>
        )}
      </Section>

      {canPay ? <BillPaymentForm bill={bill} outstanding={owed} currency={currency} accounts={serialize(accounts)} /> : null}
    </div>
  );
}
