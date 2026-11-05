import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import DecisionButtons from "@/components/dashboard/inventory/DecisionButtons";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { userNames } from "@/server/content/inventory-admin";
import { getAdjustment } from "@/server/services/stock-adjustment.service";
import { DOCUMENT_STATES, adjustmentTypeLabel, formatQuantity, selfApproved } from "@/lib/inventory";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adjustment — FoodZone", robots: { index: false, follow: false } };

const when = (date) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function StockAdjustmentPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/stock-adjustments/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "stock_adjustments.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getAdjustment(id));
  // Another branch's adjustment is simply not there, as the API answers it.
  if (!raw || !can(principal, "stock_adjustments.read", { branchId: raw.location.branchId })) notFound();

  const adjustment = serialize(raw);
  const [{ currency }, names] = await Promise.all([getSiteIdentity(), userNames([adjustment.createdById, adjustment.approvedById])]);
  const state = DOCUMENT_STATES[adjustment.status] ?? DOCUMENT_STATES.DRAFT;
  const waiting = ["PENDING_APPROVAL", "DRAFT"].includes(adjustment.status);
  const canDecide = waiting && can(principal, "stock_adjustments.approve", { branchId: adjustment.location.branchId });
  const self = selfApproved(adjustment.createdById, adjustment.approvedById);
  const opening = adjustment.type === "OPENING_STOCK";
  const dated = (date) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`${opening ? "Opening stock" : "Adjustment"} ${adjustment.adjustmentNumber}`}
        description={`${adjustment.location.name} · raised ${when(adjustment.createdAt)}${names[adjustment.createdById] ? ` by ${names[adjustment.createdById]}` : ""}`}
        back={{ href: "/dashboard/stock-adjustments", label: "Adjustments" }}
        actions={
          <div className="flex flex-wrap gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {opening ? <Chip tone="bg-tertiary-container text-on-tertiary-container">{adjustmentTypeLabel(adjustment.type)}</Chip> : null}
            {adjustment.status === "COMPLETED" && self ? <Chip>Self-approved</Chip> : null}
          </div>
        }
      />

      <Section title="Why">
        <p className="whitespace-pre-line text-body-md text-on-surface">{adjustment.reason}</p>
        {adjustment.approvedAt ? (
          <p className="text-body-md text-on-surface-variant">
            {adjustment.status === "COMPLETED" ? "Approved" : "Rejected"} {when(adjustment.approvedAt)}
            {names[adjustment.approvedById] ? ` by ${names[adjustment.approvedById]}` : ""}
            {self ? " — the same person who raised it." : "."}
          </p>
        ) : null}
      </Section>

      <Section title="Items">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Adjustment lines</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Change</th>
                <th scope="col" className="hidden py-2 pr-4 text-right font-normal sm:table-cell">Cost each</th>
                <th scope="col" className="py-2 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {adjustment.items.map((line) => (
                <tr key={line.id} className="border-b border-outline-variant/60 align-top last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/inventory-items/${line.item.id}`} className="text-on-surface hover:underline">{line.item.name}</Link>
                    {line.note ? <span className="block text-on-surface-variant">“{line.note}”</span> : null}
                    {line.item.trackBatches && Number(line.quantity) > 0 ? (
                      <span className="block text-on-surface-variant">
                        {line.batchNumber ? `Batch ${line.batchNumber}` : "Batch numbered on approval"}
                        {line.expiryDate ? ` · use by ${dated(line.expiryDate)}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className={`py-2 pr-4 text-right tabular-nums text-label-bold ${Number(line.quantity) < 0 ? "text-error" : "text-success"}`}>
                    {formatQuantity(line.quantity, { precision: 6, unit: line.item.uom.code, signed: true })}
                  </td>
                  <td className="hidden py-2 pr-4 text-right tabular-nums text-on-surface-variant sm:table-cell">{formatMoney(line.unitCost, currency)}</td>
                  <td className="py-2 text-right tabular-nums text-on-surface">{formatMoney(line.totalCost, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} className="pt-3 text-left text-label-bold text-on-surface sm:hidden">Total</th>
                <th scope="row" colSpan={3} className="hidden pt-3 text-left text-label-bold text-on-surface sm:table-cell">Total</th>
                <td className="pt-3 text-right tabular-nums text-label-bold text-on-surface">{formatMoney(adjustment.totalValue, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {opening ? (
          <p className="text-body-md text-on-surface-variant">Opening stock is booked at the cost given here. In the accounts it is part of the opening position — inventory against opening balance equity — not a gain for the month.</p>
        ) : waiting ? (
          <p className="text-body-md text-on-surface-variant">Values are at the cost when it was raised. Stock removed is booked at the item&apos;s average cost on the day it is approved.</p>
        ) : null}
      </Section>

      {canDecide ? (
        <Section title="Decide" description="Approving moves the stock now. Rejecting leaves it untouched.">
          <DecisionButtons
            approveEndpoint={`/admin/stock-adjustments/${adjustment.id}/approve`}
            rejectEndpoint={`/admin/stock-adjustments/${adjustment.id}/reject`}
            approveLabel="Approve and post"
            approveSuccess={`${opening ? "Opening stock" : "Adjustment"} ${adjustment.adjustmentNumber} posted.`}
            rejectSuccess={`Adjustment ${adjustment.adjustmentNumber} rejected.`}
            confirm="Approve this adjustment? The stock changes straight away and cannot be un-posted — only corrected by another adjustment."
            selfRaised={adjustment.createdById === principal.userId}
          />
        </Section>
      ) : waiting ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">Waiting for someone who can approve adjustments at this branch.</p>
      ) : null}
    </div>
  );
}
