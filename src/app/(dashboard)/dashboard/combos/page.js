import Link from "next/link";
import { redirect } from "next/navigation";
import { ImageOff, Layers, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ProductSaleChip from "@/components/dashboard/products/ProductSaleChip";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { listProducts, menuPlacements } from "@/server/services/product.service";
import { comboGroupsFor } from "@/server/services/combo.service";
import { serialize } from "@/lib/api/serialize";
import { comboHealth, describeSlotChoices, describeSlotRule } from "@/lib/combo-rules";
import { productSaleState } from "@/lib/product-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";
import StoredImage from "@/components/ui/StoredImage";

export const metadata = { title: "Combos — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Every combo, its slots at a glance, and whether it can actually be ordered.
 *
 * A combo breaks without anyone touching it — unpublish the only drink it
 * offers and it can no longer be completed — so health is recomputed from the
 * live slot choices on every load rather than stored.
 */
export default async function CombosPage({ searchParams }) {
  const [viewer, { currency }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);
  if (!viewer) redirect(loginHref("/dashboard/combos"));
  if (!hasPermission(viewer.permissions, "combos.read")) redirect("/dashboard");

  const { cursor: rawCursor } = await searchParams;
  const cursor = (Array.isArray(rawCursor) ? rawCursor[0] : rawCursor) || undefined;
  const page = await listProducts({ type: "COMBO", limit: PAGE_SIZE, cursor });
  const ids = page.items.map((item) => item.id);
  const [placements, slots] = await Promise.all([menuPlacements(ids), comboGroupsFor(ids)]);
  const combos = serialize(page.items);

  const canCreate = hasPermission(viewer.permissions, "combos.create") && hasPermission(viewer.permissions, "products.create");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Combos"
        description="Meal deals built from your products — each slot is a choice the customer makes."
        actions={
          canCreate ? (
            <Link href="/dashboard/combos/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New combo
            </Link>
          ) : null
        }
      />

      {combos.length ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {combos.map((combo) => {
            const groups = serialize(slots.get(combo.id) ?? []);
            const issues = comboHealth(groups);
            const state = productSaleState(combo, placements.get(combo.id) ?? [], { comboIssues: issues });
            return (
              <li key={combo.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="flex items-start gap-3">
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-field bg-surface-container-low">
                    {combo.imageUrl ? (
                       
                      <StoredImage src={combo.imageUrl} className="size-full object-cover" />
                    ) : (
                      <ImageOff aria-hidden="true" className="size-4 text-on-surface-variant" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-headline-md text-on-surface">
                      <Link href={`/dashboard/combos/${combo.id}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        {combo.name}
                      </Link>
                    </h2>
                    <p className="text-body-md tabular-nums text-on-surface-variant">
                      {combo.priceFrom === null ? "No price" : formatMoney(combo.priceFrom, currency)} · {combo.category?.name}
                    </p>
                  </div>
                  <ProductSaleChip state={state} />
                </div>
                {groups.length ? (
                  <ol className="flex flex-col gap-1 text-body-md">
                    {groups.map((group) => (
                      <li key={group.id} className="flex flex-wrap justify-between gap-2">
                        <span className="text-on-surface">{group.name}</span>
                        <span className="text-on-surface-variant">
                          {describeSlotRule(group)} · {describeSlotChoices(group)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-body-md text-on-surface-variant">No slots yet.</p>
                )}
                {state.key === "COMBO_INCOMPLETE" ? <p className="text-label-bold text-error">{state.detail}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <Layers aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">No combos yet</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            A combo is a meal deal — a burger, a side and a drink for one price. Create the products first, then build the combo from them.
          </p>
          {canCreate ? (
            <Link href="/dashboard/combos/new" className="mt-2 inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container">
              <Plus aria-hidden="true" className="size-4" />
              Create the first combo
            </Link>
          ) : null}
        </div>
      )}

      {page.nextCursor || cursor ? (
        <div className="flex flex-wrap justify-center gap-4">
          {cursor ? <Link href="/dashboard/combos" className="text-label-bold text-primary hover:underline">Back to the first page</Link> : null}
          {page.nextCursor ? (
            <Link href={`/dashboard/combos?cursor=${page.nextCursor}`} className="rounded-field bg-surface-container-high px-6 py-3 text-label-bold text-on-surface">Next page</Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
