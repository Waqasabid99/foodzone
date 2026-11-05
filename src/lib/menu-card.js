/**
 * A catalog row, in the shape `MenuItemCard` reads.
 *
 * The card is the one place a dish is drawn on this site — the menu, a product
 * page's "more from", the home page — and it wants a flatter object than the
 * catalog service returns: prices as numbers rather than `Decimal`, variants
 * carrying `variantId` rather than `id`. Every caller was doing that mapping
 * inline, which is how one of them ends up quietly missing a field.
 *
 * **Availability is asserted, not known.** These lists are branch-agnostic and,
 * on the home page, cached — so "in stock" here would be a guess with a
 * five-minute shelf life. The card shows the dish; the server prices and
 * refuses the line when somebody actually adds it, which is the only place the
 * answer is true at the moment it matters.
 */
export function toMenuCard(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? null,
    imageUrl: product.imageUrl ?? null,
    dietary: product.dietary ?? [],
    spiceLevel: product.spiceLevel ?? null,
    isRecommended: Boolean(product.isFeatured),
    isCombo: product.type === "COMBO",
    priceFrom: product.priceFrom ?? null,
    compareAtPrice: product.defaultVariant?.compareAtPrice
      ? Number(product.defaultVariant.compareAtPrice)
      : null,
    available: true,
    variants: (product.variants ?? []).map((variant) => ({
      variantId: variant.id,
      name: variant.name,
      price: Number(variant.price),
      compareAtPrice: variant.compareAtPrice ? Number(variant.compareAtPrice) : null,
      available: true,
    })),
  };
}
