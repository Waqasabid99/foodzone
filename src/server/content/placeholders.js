/**
 * Stand-in content for a catalog that has nothing in it yet.
 *
 * Kept in one file, apart from the components, for two reasons. It makes the
 * boundary obvious — anything imported from here is *not* real data, and the
 * day the catalog fills up this file stops being reached. And it means no
 * component has an invented burger baked into its markup, which is how
 * placeholder copy survives to production and ends up on a real storefront.
 *
 * Every consumer marks its result with `isPlaceholder`, so the page can say so
 * rather than quietly presenting fiction as inventory.
 */

export const PLACEHOLDER_CATEGORIES = [
  { id: "ph-burgers", name: "Burgers", slug: "burgers", productCount: 0 },
  { id: "ph-sides", name: "Sides", slug: "sides", productCount: 0 },
  { id: "ph-pizza", name: "Pizza", slug: "pizza", productCount: 0 },
  { id: "ph-wings", name: "Wings", slug: "wings", productCount: 0 },
  { id: "ph-drinks", name: "Drinks", slug: "drinks", productCount: 0 },
];

export const PLACEHOLDER_DEAL = {
  id: "ph-deal",
  name: "The Volcano Combo",
  slug: "volcano-combo",
  shortDescription: "Spicy crispy chicken, large fries, large drink.",
  badge: "Limited time",
  priceFrom: 1299,
  compareAtPrice: 1899,
  imageUrl: null,
};

export const PLACEHOLDER_FEATURED = [
  {
    id: "ph-wings",
    name: "Sweet Heat Wings",
    slug: "sweet-heat-wings",
    shortDescription: "6 pieces tossed in our signature bold sauce.",
    priceFrom: 749,
    compareAtPrice: null,
    imageUrl: null,
    dietary: [],
    spiceLevel: 3,
  },
  {
    id: "ph-smash",
    name: "Double Smash Burger",
    slug: "double-smash-burger",
    shortDescription: "Two smashed patties, melted cheese, house sauce.",
    priceFrom: 1099,
    compareAtPrice: null,
    imageUrl: null,
    dietary: [],
    spiceLevel: 0,
  },
  {
    id: "ph-fries",
    name: "Crispy Loaded Fries",
    slug: "crispy-loaded-fries",
    shortDescription: "Skin-on fries, cheese sauce, crispy onions.",
    priceFrom: 549,
    compareAtPrice: null,
    imageUrl: null,
    dietary: ["VEG"],
    spiceLevel: 0,
  },
];

export const PLACEHOLDER_REVIEWS = [
  {
    id: "ph-r1",
    rating: 5,
    comment: "Hands down the best spicy chicken sandwich I've ever had. The crunch is real!",
    authorName: "Jake D.",
    productName: null,
  },
  {
    id: "ph-r2",
    rating: 5,
    comment: "Insanely fast delivery and the fries were actually crispy when they arrived. 10/10.",
    authorName: "Sarah M.",
    productName: null,
  },
  {
    id: "ph-r3",
    rating: 5,
    comment: "Those Sweet Heat Wings are addictive. I order them every single week now.",
    authorName: "Tyrell R.",
    productName: null,
  },
];

/**
 * The three steps, which are a statement about how the business works rather
 * than data. They live here so the copy is edited in one place, not so they are
 * ever replaced by a query.
 */
export const HOW_IT_WORKS = [
  {
    id: "order",
    step: 1,
    icon: "pointer",
    title: "Order Bold",
    body: "Customize your crave-worthy meal in just a few taps.",
  },
  {
    id: "cook",
    step: 2,
    icon: "flame",
    title: "We Cook",
    body: "We fire up the grill and prepare your order fresh.",
  },
  {
    id: "deliver",
    step: 3,
    icon: "bike",
    title: "Fast Delivery",
    body: "Hot, fresh, and delivered right to your door in a snap.",
  },
];

