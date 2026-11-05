import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import StartRunForm from "@/components/dashboard/production/StartRunForm";
import IssueMaterialForm from "@/components/dashboard/production/IssueMaterialForm";
import CompleteRunForm from "@/components/dashboard/production/CompleteRunForm";
import ReplanForm from "@/components/dashboard/production/ReplanForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { itemOptions, userNames } from "@/server/content/inventory-admin";
import { itemUnits } from "@/server/content/production-admin";
import { getProductionOrder, withoutRunCosts } from "@/server/services/production-order.service";
import { productionCostVisible } from "@/server/inventory/access";
import { formatQuantity } from "@/lib/inventory";
import { PRODUCTION_STATES, yieldPercent } from "@/lib/production";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Production batch — FoodZone", robots: { index: false, follow: false } };

const when = (date) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (date) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function ProductionRunPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/production/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "production_orders.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getProductionOrder(id));
  // Another branch's batch is simply not there, as the API answers it.
  if (!raw || !can(principal, "production_orders.read", { branchId: raw.branchId })) notFound();

  const branchId = raw.branchId;
  const showCost = productionCostVisible(principal, branchId);
  const run = serialize(showCost ? raw : withoutRunCosts(raw));

  const allowed = (key) => can(principal, key, { branchId });
  const canStart = run.status === "PLANNED" && allowed("production_orders.start");
  const canIssue = run.status === "IN_PROGRESS" && allowed("production_orders.start");
  const canComplete = run.status === "IN_PROGRESS" && allowed("production_orders.complete");
  const canCancel = ["PLANNED", "IN_PROGRESS"].includes(run.status) && allowed("production_orders.cancel");
  const canReplan = run.status === "PLANNED" && allowed("production_orders.create");

  const [{ currency }, names, units, issuable] = await Promise.all([
    getSiteIdentity(),
    userNames([run.createdById]),
    itemUnits([...run.materials.map((line) => line.itemId), ...run.outputs.map((output) => output.itemId)]),
    canIssue ? itemOptions().then(serialize) : [],
  ]);

  const state = PRODUCTION_STATES[run.status] ?? PRODUCTION_STATES.PLANNED;
  const yieldUnit = run.recipe.yieldUom;
  const made = (value) => formatQuantity(value, { precision: yieldUnit.precision, unit: yieldUnit.code });
  const stock = (itemId, value) => formatQuantity(value, { precision: units[itemId]?.precision ?? 3, unit: units[itemId]?.code });
  const output = run.recipe.outputItem;
  const shortLines = run.status === "PLANNED" ? run.materials.filter((line) => Number(line.plannedQuantity) > Number(line.onHand)) : [];
  const yieldPct = yieldPercent(run.producedQuantity, run.wastedQuantity);
  const over = showCost && run.costVariance ? Number(run.costVariance.variance) : 0;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Batch ${run.productionNumber}`}
        description={`${made(run.plannedQuantity)} of ${output?.name ?? "stock"} at ${run.location.name}${names[run.createdById] ? ` · planned by ${names[run.createdById]}` : ""}`}
        back={{ href: "/dashboard/production", label: "Production" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      <Section title="The batch">
        <dl className="grid gap-4 text-body-md sm:grid-cols-2">
          <Detail label="Recipe">
            <Link href={`/dashboard/recipes/${run.recipe.id}`} className="text-on-surface hover:underline">{run.recipe.name}</Link> <span className="text-on-surface-variant">version {run.recipe.version}</span>
          </Detail>
          <Detail label="Makes">
            {output ? <Link href={`/dashboard/inventory-items/${output.id}`} className="text-on-surface hover:underline">{output.name}</Link> : "—"}
          </Detail>
          <Detail label="Planned">{made(run.plannedQuantity)}{run.scheduledFor ? ` for ${day(run.scheduledFor)}` : ""}</Detail>
          {run.batchNumber ? <Detail label="Batch number">{run.batchNumber}</Detail> : null}
          {run.startedAt ? <Detail label="Started">{when(run.startedAt)}</Detail> : null}
          {run.completedAt ? <Detail label="Finished">{when(run.completedAt)}</Detail> : null}
        </dl>
        {run.notes ? <p className="whitespace-pre-line text-body-md text-on-surface-variant">{run.notes}</p> : null}
        {canReplan ? <ReplanForm run={run} /> : null}
      </Section>

      <Section
        title="Ingredients"
        description={run.status === "PLANNED" ? `What the recipe calls for against what is at ${run.location.name} now.` : "What the recipe called for against what was actually taken out."}
      >
        {shortLines.length ? (
          <p role="status" className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            Short of {shortLines.map((line) => line.name).join(", ")} here. Move stock to {run.location.name} or make less before starting.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Ingredients for this batch</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Recipe</th>
                {run.status === "PLANNED" ? (
                  <th scope="col" className="py-2 text-right font-normal">Here now</th>
                ) : (
                  <>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">Taken out</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">Difference</th>
                    {showCost ? <th scope="col" className="hidden py-2 text-right font-normal sm:table-cell">Cost</th> : null}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {run.materials.map((line) => {
                const diff = Number(line.usageVariance ?? 0);
                return (
                  <tr key={line.itemId} className="border-b border-outline-variant/60 align-top last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/dashboard/inventory-items/${line.itemId}`} className="text-on-surface hover:underline">{line.name}</Link>
                      {line.unplanned ? <span className="block text-on-surface-variant">Not in the recipe</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{stock(line.itemId, line.plannedQuantity)}</td>
                    {run.status === "PLANNED" ? (
                      <td className={`py-2 text-right tabular-nums ${Number(line.plannedQuantity) > Number(line.onHand) ? "text-label-bold text-error" : ""}`}>{stock(line.itemId, line.onHand)}</td>
                    ) : (
                      <>
                        <td className="py-2 pr-4 text-right tabular-nums">{stock(line.itemId, line.actualQuantity)}</td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${diff > 0 ? "text-error" : "text-on-surface-variant"}`}>
                          {diff ? formatQuantity(line.usageVariance, { precision: units[line.itemId]?.precision ?? 3, unit: units[line.itemId]?.code, signed: true }) : "—"}
                        </td>
                        {showCost ? (
                          <td className="hidden py-2 text-right tabular-nums sm:table-cell">{Number(line.actualQuantity) ? formatMoney(Number(line.actualQuantity) * Number(line.unitCost), currency) : "—"}</td>
                        ) : null}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {canStart ? (
        <Section title="Start" description="Set what you are really taking out if it differs from the recipe. The ingredients leave stock when you start.">
          <StartRunForm run={run} materials={run.materials} units={units} />
        </Section>
      ) : run.status === "PLANNED" ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">Waiting for someone who can start batches at this branch.</p>
      ) : null}

      {canIssue ? (
        <Section title="Take out more" description="Needed more than planned? Record it here, so the batch shows what really went in.">
          <IssueMaterialForm run={run} items={issuable} />
        </Section>
      ) : null}

      {canComplete ? (
        <Section title="Finish" description="Enter what came out. It goes into stock at what the batch actually cost.">
          <CompleteRunForm run={run} includeCost={showCost} />
        </Section>
      ) : null}

      {run.status === "COMPLETED" ? (
        <Section title="What came out">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Figure label="Usable" value={made(run.producedQuantity)} strong />
            <Figure label="Lost" value={Number(run.wastedQuantity) ? made(run.wastedQuantity) : "None"} />
            <Figure label="Against the plan" value={`${run.yieldVariance.yieldPercent}%`} hint={yieldPct != null && yieldPct < 100 ? `${yieldPct}% of what was made was usable` : null} />
          </dl>
          {run.outputs.length ? (
            <ul className="flex flex-col gap-2">
              {run.outputs.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-surface-container-low px-4 py-3 text-body-md">
                  <span>
                    <Link href={`/dashboard/inventory-items/${row.itemId}`} className="text-label-bold text-on-surface hover:underline">{row.item.name}</Link>
                    <span className="text-on-surface-variant"> {row.isPrimary ? "into stock" : "by-product"}{row.batchId && row.isPrimary && run.batchNumber ? ` · batch ${run.batchNumber}` : ""}</span>
                  </span>
                  <span className="tabular-nums text-on-surface">
                    {stock(row.itemId, row.quantity)}
                    {showCost ? ` · ${formatMoney(row.totalCost, currency)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {showCost ? (
            <>
              <dl className="grid gap-4 sm:grid-cols-4">
                <Figure label="Ingredients" value={formatMoney(run.materialCost, currency)} />
                <Figure label="Labour and overhead" value={formatMoney(Number(run.laborCost) + Number(run.overheadCost), currency)} />
                <Figure label="Whole batch" value={formatMoney(run.totalCost, currency)} strong />
                <Figure label={`Per ${yieldUnit.code}`} value={run.unitCost != null ? formatMoney(run.unitCost, currency) : "—"} />
              </dl>
              {run.standardCost != null ? (
                <p className="text-body-md text-on-surface">
                  The recipe expected {formatMoney(run.standardCost, currency)} for the planned amount.{" "}
                  <span className={`text-label-bold ${over > 0 ? "text-error" : "text-success"}`}>
                    {over > 0 ? `${formatMoney(over, currency)} over (${run.costVariance.variancePercent}%).` : over < 0 ? `${formatMoney(-over, currency)} under.` : "Exactly on target."}
                  </span>
                </p>
              ) : null}
            </>
          ) : null}
        </Section>
      ) : null}

      {run.status === "CANCELLED" ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">
          This batch was cancelled. {run.startedAt ? "Everything taken out for it went back into stock." : "Nothing had been taken out."}
        </p>
      ) : null}

      {canCancel ? (
        <Section title="Cancel" description={run.status === "IN_PROGRESS" ? "Everything taken out for this batch goes back into stock, onto the batches it came from." : "Nothing has been taken out yet, so nothing moves."}>
          <ActionButton
            endpoint={`/admin/production-orders/${run.id}/cancel`}
            body={{}}
            tone="danger"
            confirm={run.status === "IN_PROGRESS" ? `Cancel ${run.productionNumber}? The ingredients go back into stock. It cannot be restarted.` : `Cancel ${run.productionNumber}?`}
            success={`${run.productionNumber} cancelled.`}
          >
            Cancel the batch
          </ActionButton>
        </Section>
      ) : null}
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-label-bold font-normal text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 text-on-surface">{children}</dd>
    </div>
  );
}

function Figure({ label, value, hint = null, strong = false }) {
  return (
    <div className="rounded-field bg-surface-container-low px-4 py-3">
      <dt className="text-label-bold font-normal text-on-surface-variant">{label}</dt>
      <dd className={`mt-1 tabular-nums ${strong ? "font-display text-headline-md text-on-surface" : "text-label-bold text-on-surface"}`}>{value}</dd>
      {hint ? <dd className="text-body-md text-on-surface-variant">{hint}</dd> : null}
    </div>
  );
}
