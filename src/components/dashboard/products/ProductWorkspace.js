import Link from "next/link";
import { ExternalLink, Info } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import HealthNotice from "@/components/dashboard/HealthNotice";
import ProductSaleChip from "@/components/dashboard/products/ProductSaleChip";
import ProductDetailsForm, { Section } from "@/components/dashboard/products/ProductDetailsForm";
import VariantEditor from "@/components/dashboard/products/VariantEditor";
import GalleryEditor from "@/components/dashboard/products/GalleryEditor";
import ModifierGroupsEditor from "@/components/dashboard/products/ModifierGroupsEditor";
import ComboSlotsEditor from "@/components/dashboard/combos/ComboSlotsEditor";
import { DeleteOrRestore, PublishButton } from "@/components/dashboard/products/ProductActions";
import { comboChoiceCatalog, productFormOptions } from "@/server/content/product-admin";
import { menuPlacements } from "@/server/services/product.service";
import { listModifierGroups, listProductModifierGroups } from "@/server/services/modifier.service";
import { listComboGroups } from "@/server/services/combo.service";
import { serialize } from "@/lib/api/serialize";
import { productSaleState } from "@/lib/product-form";
import { comboHealth } from "@/lib/combo-rules";
import { menuTypeLabel } from "@/lib/menu-schedule";
import { hasPermission } from "@/lib/dashboard-nav";


/**
 * One product — or one combo — and everything that decides whether it sells.
 *
 * Shared by the Products and Combos pages because a combo *is* a product: the
 * same details, price, photos, publish state and menu placement. What differs
 * is the last editor — a product's option groups, or a combo's slots — and the
 * extra health check a combo needs, since its slots can be broken by changes
 * made to other products.
 *
 * Each block saves on its own: separate records, endpoints and permissions.
 */
export default async function ProductWorkspace({ raw, viewer, currency }) {
  const can = (key) => hasPermission(viewer.permissions, key);
  const id = raw.id;
  const combo = raw.type === "COMBO";
  const deleted = Boolean(raw.deletedAt);
  const listHref = combo ? "/dashboard/combos" : "/dashboard/products";

  const [options, placements, attached, groups, slots, catalog] = await Promise.all([
    productFormOptions({ current: raw }),
    menuPlacements([id]),
    !combo && !deleted ? listProductModifierGroups(id) : [],
    !combo && !deleted && can("products.update") ? listModifierGroups() : [],
    combo ? listComboGroups(id) : [],
    combo && !deleted && can("combos.update") ? comboChoiceCatalog() : [],
  ]);

  const product = serialize(raw);
  const comboSlots = serialize(slots);
  const issues = combo && !deleted ? comboHealth(comboSlots) : [];
  const menus = placements.get(id) ?? [];
  const state = productSaleState(product, menus, { comboIssues: issues });
  const editable = can("products.update") && !deleted;
  const defaultVariant = product.variants.find((variant) => variant.isDefault) ?? product.variants[0] ?? null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={product.name}
        description={`${product.category?.name ?? "No category"}${combo ? " · Combo" : ""}`}
        back={{ href: listHref, label: combo ? "Combos" : "Products" }}
        actions={
          <>
            {state.key === "ON_SALE" ? (
              <Link href={`/menu/${product.slug}`} target="_blank" className="inline-flex items-center gap-2 rounded-field px-4 py-2.5 text-label-bold text-primary hover:underline">
                View on website
                <ExternalLink aria-hidden="true" className="size-4" />
                <span className="sr-only">(opens in a new tab)</span>
              </Link>
            ) : null}
            {can("products.publish") && !deleted ? <PublishButton productId={id} isActive={product.isActive} /> : null}
          </>
        }
      />

      <div className={`flex flex-wrap items-center gap-3 rounded-card px-5 py-4 ${state.key === "ON_SALE" ? "bg-surface-container-lowest" : "bg-surface-container-low"}`}>
        <ProductSaleChip state={state} />
        <p className="text-body-md text-on-surface">
          {state.detail}
          {state.key === "DRAFT" && !can("products.publish") ? " Ask a manager to publish it." : ""}
        </p>
      </div>

      {/* The blocking issue is already the status line; the rest are listed. */}
      <HealthNotice issues={issues.filter((issue) => issue.message !== state.detail)} />

      {combo && !deleted ? (
        <p className="flex items-start gap-2 rounded-card bg-surface-container-low px-5 py-3 text-body-md text-on-surface">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-on-surface-variant" />
          <span>
            Customers build this on its product page: each slot below becomes a choice, and the surcharges are shown
            where the choice is made. A slot whose every option has been unpublished cannot be completed, so the page
            says the combo is unavailable rather than taking an order it cannot fill.
          </span>
        </p>
      ) : null}

      <ProductDetailsForm product={product} options={options} currency={currency} canUpload={can("media.upload")} readOnly={!editable} />

      {deleted ? null : (
        <>
          <VariantEditor
            productId={id}
            variants={product.variants}
            currency={currency}
            title={combo ? "Combo price" : undefined}
            can={{ create: !combo && can("variants.create"), update: can("variants.update"), delete: !combo && can("variants.delete") }}
          />

          {combo ? (
            <ComboSlotsEditor
              comboId={id}
              groups={comboSlots}
              catalog={catalog}
              basePrice={defaultVariant ? defaultVariant.price : null}
              currency={currency}
              can={{ create: can("combos.create"), update: can("combos.update"), delete: can("combos.delete") }}
            />
          ) : null}

          <GalleryEditor productId={id} productName={product.name} images={product.images} canUpload={editable && can("media.upload")} />

          {combo ? null : (
            <ModifierGroupsEditor
              productId={id}
              attached={serialize(attached)}
              available={serialize(groups)}
              canEdit={editable}
              canManageGroups={can("modifiers.create")}
            />
          )}
        </>
      )}

      <Section title="Where it is sold" description="Only orderable at a branch whose menu includes it.">
        {menus.length ? (
          <ul className="flex flex-col gap-2">
            {menus.map((menu) => (
              <li key={menu.id} className="flex flex-wrap items-baseline justify-between gap-2 text-body-md">
                {can("menus.read") ? (
                  <Link href={`/dashboard/menus/${menu.id}`} className="text-on-surface hover:underline">
                    {menu.branch.name} — {menu.name}
                  </Link>
                ) : (
                  <span className="text-on-surface">
                    {menu.branch.name} — {menu.name}
                  </span>
                )}
                <span className="text-on-surface-variant">
                  {menuTypeLabel(menu.type)}
                  {menu.isActive ? "" : " · switched off"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">Not on any menu yet. It is added to a branch&rsquo;s menu from the Menus page.</p>
        )}
      </Section>

      {can("products.delete") ? (
        <section className="flex flex-col gap-3 rounded-card border border-outline-variant p-5 sm:p-6">
          <h2 className="font-display text-headline-md text-on-surface">{deleted ? `Restore this ${combo ? "combo" : "product"}` : `Delete this ${combo ? "combo" : "product"}`}</h2>
          <p className="text-body-md text-on-surface-variant">
            {deleted
              ? "Restoring brings it back as an unpublished draft. It was removed from every menu when it was deleted, so it will need adding again."
              : "Order history keeps its record. It is removed from every menu at once. If you only want to stop selling it for now, unpublish it instead."}
          </p>
          <div>
            <DeleteOrRestore productId={id} name={product.name} deleted={deleted} menuCount={menus.length} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
