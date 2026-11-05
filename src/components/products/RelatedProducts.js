import MenuItemCard from "@/components/menu/MenuItemCard";
import { toMenuCard } from "@/lib/menu-card";

/**
 * "Pairs perfectly with" — other products from the same category.
 *
 * Same-category is a weak signal, and it is labelled as what it is ("more from
 * X") rather than dressed up as a pairing the kitchen recommends. Real
 * pairings would come from the combo groups the product already carries, or
 * from what people actually order together; neither is wired yet, and inventing
 * a chef's recommendation is the kind of small lie that spreads.
 */
export default function RelatedProducts({ items, categoryName, currency, branchId }) {
  if (!items.length) return null;

  return (
    <section aria-labelledby="related-heading">
      <p className="text-label-bold uppercase tracking-widest text-primary">Complete your tray</p>
      <h2 id="related-heading" className="mt-2 font-display text-headline-md text-on-surface">
        More from {categoryName ?? "the menu"}
      </h2>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <MenuItemCard key={item.id} item={toMenuCard(item)} currency={currency} branchId={branchId} />
        ))}
      </div>
    </section>
  );
}
