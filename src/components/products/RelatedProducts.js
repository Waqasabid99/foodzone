import MenuItemCard from "@/components/menu/MenuItemCard";

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
          <MenuItemCard
            key={item.id}
            item={{
              id: item.id,
              name: item.name,
              slug: item.slug,
              shortDescription: item.shortDescription,
              imageUrl: item.imageUrl,
              dietary: item.dietary ?? [],
              spiceLevel: item.spiceLevel,
              isRecommended: Boolean(item.isFeatured),
              priceFrom: item.priceFrom,
              compareAtPrice: null,
              available: true,
              variants: (item.variants ?? []).map((variant) => ({
                variantId: variant.id,
                name: variant.name,
                price: Number(variant.price),
                compareAtPrice: null,
                available: true,
              })),
            }}
            currency={currency}
            branchId={branchId}
          />
        ))}
      </div>
    </section>
  );
}
