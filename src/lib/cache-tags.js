/**
 * Cache tags for on-demand revalidation.
 *
 * Named in one place so a page that caches catalog data and a mutation that
 * should invalidate it cannot disagree about the string. Tag names are a
 * contract in exactly the way permission keys are: cheap to add, breaking to
 * rename.
 *
 * Today the home page revalidates on a timer. Wiring on-demand invalidation is
 * then one line in each admin mutation route — `revalidateTag(CacheTag.CATALOG)`
 * after a successful write — which is what makes a price change visible in
 * seconds rather than at the end of the window.
 */
export const CacheTag = {
  /// Products, categories, and anything derived from the public catalog.
  CATALOG: "catalog",
  /// Published customer reviews.
  REVIEWS: "reviews",
  /// Store settings: name, currency, whether ordering is on.
  SETTINGS: "settings",
  /// Everything the home page reads.
  HOME: "home",
  /// Branch menus: sections, items, availability windows.
  MENUS: "menus",
  /// The outlet list — names, addresses, opening hours.
  BRANCHES: "branches",
};
