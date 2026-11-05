import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import CountSheet from "@/components/dashboard/inventory/CountSheet";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { userNames } from "@/server/content/inventory-admin";
import { getCount } from "@/server/services/stock-count.service";
import { COUNT_STATES, formatQuantity, selfApproved } from "@/lib/inventory";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock count — FoodZone", robots: { index: false, follow: false } };

const when = (date) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * One count. While it is being counted the page is the blind sheet — the
 * system's figures are not sent to the browser at all. Once submitted, it is
 * the comparison a manager posts or throws away.
 */
export default async function StockCountPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/stock-counts/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "stock_counts.read")) redirect("/dashboard");

  const peek = await nullIfMissing(getCount(id, { blind: true }));
  if (!peek || !can(principal, "stock_counts.read", { branchId: peek.branchId })) notFound();

  const counting = peek.status === "DRAFT";
  const raw = counting ? peek : await getCount(id);
  const count = serialize(raw);
  const [{ currency }, names] = await Promise.all([getSiteIdentity(), userNames([count.countedById, count.approvedById])]);
  const state = COUNT_STATES[count.status] ?? COUNT_STATES.DRAFT;
  const canCount = counting && can(principal, "stock_counts.submit", { branchId: count.branchId });
  const canApprove = can(principal, "stock_counts.approve", { branchId: count.branchId });
  const waiting = count.status === "PENDING_APPROVAL";
  const self = selfApproved(count.countedById, count.approvedById);

  const lines = counting ? [] : count.items;
  const off = lines.filter((line) => Number(line.varianceQuantity) !== 0);
  const short = lines.filter((line) => Number(line.varianceQuantity) < 0).reduce((sum, line) => sum + Number(line.varianceValue), 0);
  const over = lines.filter((line) => Number(line.varianceQuantity) > 0).reduce((sum, line) => sum + Number(line.varianceValue), 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`Count ${count.countNumber}`}
        description={`${count.location.name} · ${count.location.branch.name}${count.scope ? ` · ${count.scope}` : ""} · started ${when(count.startedAt)}`}
        back={{ href: "/dashboard/stock-counts", label: "Stock counts" }}
        actions={
          <div className="flex flex-wrap gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {count.status === "COMPLETED" && self ? <Chip>Self-approved</Chip> : null}
          </div>
        }
      />

      {counting ? (
        canCount ? (
          <Section title="Count sheet" description="Count what is physically there and enter it. The system's figure is hidden until you submit, on purpose.">
            <CountSheet count={count} />
          </Section>
        ) : (
          <Section title="Being counted" description={`${count.items.length} items on this sheet. Only someone who can submit counts at this branch can fill it in.`}>
            <ul className="flex flex-col gap-1 text-body-md text-on-surface">
              {count.items.map((line) => <li key={line.itemId}>{line.item.name}</li>)}
            </ul>
          </Section>
        )
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Lines off" value={`${off.length} of ${lines.length}`} note={off.length ? "Differ from the system" : "Everything matched"} />
            <StatTile label="Short" value={formatMoney(short, currency)} note="Less on the shelf than recorded" />
            <StatTile label="Over" value={formatMoney(over, currency)} note="More on the shelf than recorded" />
          </div>

          <Section
            title="Counted against the system"
            description={`System figures were taken when the count started, ${when(count.startedAt)}.${count.completedAt ? ` Submitted ${when(count.completedAt)}${names[count.countedById] ? ` by ${names[count.countedById]}` : ""}.` : ""}`}
          >
            {count.notes ? <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface">“{count.notes}”</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-md">
                <caption className="sr-only">Count lines</caption>
                <thead>
                  <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                    <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                    <th scope="col" className="hidden py-2 pr-4 text-right font-normal sm:table-cell">System</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">Counted</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">Difference</th>
                    <th scope="col" className="hidden py-2 text-right font-normal md:table-cell">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const variance = Number(line.varianceQuantity);
                    const qty = (value, options) => formatQuantity(value, { precision: line.item.uom.precision, unit: line.item.uom.code, ...options });
                    return (
                      <tr key={line.id} className="border-b border-outline-variant/60 align-top last:border-0">
                        <td className="py-2 pr-4">
                          <Link href={`/dashboard/inventory-items/${line.item.id}`} className="text-on-surface hover:underline">{line.item.name}</Link>
                          {line.reason ? <span className="block text-on-surface-variant">“{line.reason}”</span> : null}
                        </td>
                        <td className="hidden py-2 pr-4 text-right tabular-nums text-on-surface-variant sm:table-cell">{qty(line.systemQuantity)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-on-surface">{qty(line.countedQuantity)}</td>
                        <td className={`py-2 pr-4 text-right tabular-nums text-label-bold ${variance < 0 ? "text-error" : variance > 0 ? "text-success" : "text-on-surface-variant"}`}>
                          {variance === 0 ? "—" : qty(line.varianceQuantity, { signed: true })}
                        </td>
                        <td className="hidden py-2 text-right tabular-nums text-on-surface-variant md:table-cell">{variance === 0 ? "—" : formatMoney(line.varianceValue, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {count.status === "COMPLETED" ? (
              <p className="text-body-md text-on-surface-variant">
                Posted{names[count.approvedById] ? ` by ${names[count.approvedById]}` : ""}
                {self ? " — the same person who counted it" : ""}. Stock at {count.location.name} was corrected by the differences above.
              </p>
            ) : null}
          </Section>
        </>
      )}

      {canApprove && (waiting || counting) ? (
        <Section
          title={waiting ? "Post it" : "Cancel it"}
          description={
            waiting
              ? "Posting corrects stock by each difference, as of now. Anything used since the count started is already in the system, so it is not counted twice."
              : "Cancelling throws the sheet away. Nothing moves."
          }
        >
          {waiting && count.countedById === principal.userId ? (
            <p className="text-body-md text-on-surface-variant">You counted this. You may post it yourself; it will be recorded as self-approved.</p>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {waiting ? (
              <ActionButton
                endpoint={`/admin/stock-counts/${count.id}/post`}
                tone="primary"
                confirm={off.length ? `Post this count? ${off.length} ${off.length === 1 ? "item" : "items"} will be corrected.` : "Post this count? Everything matched, so no stock changes."}
                success={`Count ${count.countNumber} posted.`}
              >
                Post the count
              </ActionButton>
            ) : null}
            <ActionButton endpoint={`/admin/stock-counts/${count.id}/cancel`} body={{}} tone="danger" confirm="Cancel this count? The numbers entered are thrown away." success={`Count ${count.countNumber} cancelled.`}>
              Cancel count
            </ActionButton>
          </div>
        </Section>
      ) : waiting ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">Waiting for a manager at this branch to post it.</p>
      ) : null}
    </div>
  );
}
