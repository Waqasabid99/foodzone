import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import ReceiveTransferForm from "@/components/dashboard/inventory/ReceiveTransferForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { userNames } from "@/server/content/inventory-admin";
import { getTransfer } from "@/server/services/stock-transfer.service";
import { formatQuantity, transferStage } from "@/lib/inventory";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transfer — FoodZone", robots: { index: false, follow: false } };

const when = (date) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * One transfer. What it offers depends on which end the viewer is at: the
 * sender dispatches or cancels it, the receiver says what arrived.
 */
export default async function StockTransferPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/stock-transfers/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock_transfers.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getTransfer(id));
  const fromBranch = raw?.fromLocation.branchId;
  const toBranch = raw?.toLocation.branchId;
  if (!raw || !(can(principal, "stock_transfers.read", { branchId: fromBranch }) || can(principal, "stock_transfers.read", { branchId: toBranch }))) notFound();

  const transfer = serialize(raw);
  const [{ currency }, names] = await Promise.all([getSiteIdentity(), userNames([transfer.createdById, transfer.approvedById])]);
  const stage = transferStage(transfer);
  const showCost = hasPermission(permissions, "stock.view_valuation");
  const canDispatch = stage.value === "DRAFT" && can(principal, "stock_transfers.approve", { branchId: fromBranch });
  const canReceive = stage.value === "IN_TRANSIT" && can(principal, "stock_transfers.receive", { branchId: toBranch });
  const between = fromBranch !== toBranch;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`Transfer ${transfer.transferNumber}`}
        description={`Created ${when(transfer.createdAt)}${names[transfer.createdById] ? ` by ${names[transfer.createdById]}` : ""}`}
        back={{ href: "/dashboard/stock-transfers", label: "Transfers" }}
        actions={<Chip tone={stage.tone}>{stage.label}</Chip>}
      />

      <Section title="Route">
        <p className="flex flex-wrap items-center gap-3 text-body-md text-on-surface">
          <span>
            <span className="block text-label-bold">{transfer.fromLocation.name}</span>
            <span className="text-on-surface-variant">{transfer.fromLocation.branch.name}</span>
          </span>
          <ArrowRight aria-label="to" className="size-5 text-on-surface-variant" />
          <span>
            <span className="block text-label-bold">{transfer.toLocation.name}</span>
            <span className="text-on-surface-variant">{transfer.toLocation.branch.name}</span>
          </span>
        </p>
        <ul className="flex flex-col gap-1 text-body-md text-on-surface-variant">
          {transfer.dispatchedAt ? <li>Left {when(transfer.dispatchedAt)}{names[transfer.approvedById] ? `, dispatched by ${names[transfer.approvedById]}` : ""}.</li> : null}
          {transfer.receivedAt ? <li>Arrived {when(transfer.receivedAt)}.</li> : null}
          {transfer.notes ? <li>“{transfer.notes}”</li> : null}
        </ul>
      </Section>

      <Section title="Items">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Transfer lines</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Sent</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Arrived</th>
                {showCost && transfer.dispatchedAt ? <th scope="col" className="hidden py-2 text-right font-normal sm:table-cell">Value</th> : null}
              </tr>
            </thead>
            <tbody>
              {transfer.items.map((line) => {
                const qty = (value) => formatQuantity(value, { precision: line.item.uom.precision, unit: line.item.uom.code });
                const shortBy = line.quantityReceived != null ? Number(line.quantitySent) - Number(line.quantityReceived) : 0;
                return (
                  <tr key={line.id} className="border-b border-outline-variant/60 last:border-0">
                    <td className="py-2 pr-4"><Link href={`/dashboard/inventory-items/${line.item.id}`} className="text-on-surface hover:underline">{line.item.name}</Link></td>
                    <td className="py-2 pr-4 text-right tabular-nums text-on-surface">{qty(line.quantitySent)}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${shortBy > 0 ? "text-error" : "text-on-surface"}`}>
                      {line.quantityReceived == null ? "—" : qty(line.quantityReceived)}
                      {shortBy > 0 ? <span className="block text-label-bold">{qty(String(shortBy))} lost</span> : null}
                    </td>
                    {showCost && transfer.dispatchedAt ? (
                      <td className="hidden py-2 text-right tabular-nums text-on-surface-variant sm:table-cell">{formatMoney(Number(line.unitCost) * Number(line.quantitySent), currency)}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {canDispatch ? (
        <Section title="Send it" description={`Dispatching takes the stock out of ${transfer.fromLocation.name} now. It shows as on the way until ${between ? transfer.toLocation.branch.name : transfer.toLocation.name} receives it.`}>
          <div className="flex flex-wrap items-start gap-3">
            <ActionButton endpoint={`/admin/stock-transfers/${transfer.id}/dispatch`} tone="primary" confirm="Dispatch this transfer? The stock leaves now." success={`Transfer ${transfer.transferNumber} is on its way.`}>
              Dispatch
            </ActionButton>
            <ActionButton endpoint={`/admin/stock-transfers/${transfer.id}/cancel`} body={{}} tone="danger" confirm="Cancel this transfer? Nothing has moved, and nothing will." success={`Transfer ${transfer.transferNumber} cancelled.`}>
              Cancel transfer
            </ActionButton>
          </div>
        </Section>
      ) : stage.value === "DRAFT" ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">Waiting to be dispatched from {transfer.fromLocation.branch.name}.</p>
      ) : null}

      {canReceive ? (
        <Section title="Receive it" description="Enter what actually arrived. Anything short is recorded as lost on the way.">
          <ReceiveTransferForm transfer={transfer} />
        </Section>
      ) : stage.value === "IN_TRANSIT" ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">On the way — {transfer.toLocation.branch.name} receives it when it arrives.</p>
      ) : null}
    </div>
  );
}
