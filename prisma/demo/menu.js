/**
 * The demo restaurant's catalog.
 *
 * Content, not code: names, prices, descriptions and photographs for a
 * plausible Karachi fast-food chain. It exists so somebody being shown this
 * system sees a working restaurant rather than empty tables and "no products
 * yet" — a demonstration of software that has never sold anything demonstrates
 * nothing.
 *
 * ## The photographs
 *
 * Unsplash, hot-linked. `images.unsplash.com` is already in `next.config.mjs`
 * so `next/image` will optimise them, nothing is committed to the repository,
 * and no storage driver has to be configured before a demo looks right.
 *
 * Every URL here was fetched and **looked at** before it was written down. A
 * 200 response only proves a photograph exists, not that it is the right one,
 * and a burger listing showing a bowl of salad is worse on a sales call than
 * no photograph at all.
 *
 * ## The prices
 *
 * Rupees, at Karachi fast-food rates as of 2026 — a burger around Rs 700, a
 * family pizza around Rs 1,900. They are here to look credible to a restaurant
 * owner, who will know immediately if they do not.
 */

const photo = (id, width = 1200) => `https://images.unsplash.com/photo-${id}?w=${width}&q=75&auto=format&fit=crop`;

export const CATEGORIES = [
  { slug: "burgers", name: "Burgers", description: "Flame-grilled beef and crispy chicken, in a toasted brioche bun.", imageUrl: photo("1568901346375-23c9450c58cd", 800) },
  { slug: "fried-chicken", name: "Fried Chicken", description: "Marinated overnight, pressure-fried to order.", imageUrl: photo("1626082927389-6cd097cdc6ec", 800) },
  { slug: "pizza", name: "Pizza", description: "Hand-stretched bases, baked in a stone deck oven.", imageUrl: photo("1565299624946-b28f40a0ae38", 800) },
  { slug: "wraps-sandwiches", name: "Wraps & Sandwiches", description: "Rolled, pressed and ready in minutes.", imageUrl: photo("1622483767028-3f66f32aef97", 800) },
  { slug: "sides", name: "Sides", description: "Fries, salads and everything that goes alongside.", imageUrl: photo("1541592106381-b31e9677c0e5", 800) },
  { slug: "desserts", name: "Desserts", description: "Worth leaving room for.", imageUrl: photo("1578985545062-69928b1d9587", 800) },
  { slug: "drinks", name: "Drinks", description: "Cold, and plenty of it.", imageUrl: photo("1626700051175-6818013e1d4f", 800) },
];

/**
 * `variants` is where the price lives — the schema puts it there, not on the
 * product, so even a single-size item has one. Sizes that a kitchen really
 * offers: a regular and a large, not a spread of five nobody orders.
 */
export const PRODUCTS = [
  // --- burgers --------------------------------------------------------------
  {
    slug: "classic-beef-burger", name: "Classic Beef Burger", category: "burgers",
    shortDescription: "Flame-grilled patty, cheddar, lettuce, tomato, house sauce.",
    description: "Our first burger and still the one we are judged on. A hundred-gram beef patty off the flame grill, melted cheddar, crisp lettuce, tomato and the house burger sauce in a toasted brioche bun.",
    image: "1571091718767-18b5b1457add", spiceLevel: 1, calories: 640, prepTimeMinutes: 10,
    variants: [{ name: "Single", price: 690, cost: 255, isDefault: true }, { name: "Double", price: 990, cost: 390 }],
    modifiers: ["add-ons", "spice-level"],
  },
  {
    slug: "double-cheese-burger", name: "Double Cheese Burger", category: "burgers",
    shortDescription: "Two patties, double cheddar, pickles and onion.",
    description: "Two beef patties, two slices of cheddar, pickles, onion and mustard mayo. Built for somebody who came in hungry.",
    image: "1568901346375-23c9450c58cd", spiceLevel: 1, calories: 910, prepTimeMinutes: 12,
    variants: [{ name: "Regular", price: 1090, cost: 430, isDefault: true }],
    modifiers: ["add-ons"],
  },
  {
    slug: "zinger-crispy-burger", name: "Zinger Crispy Burger", category: "burgers",
    shortDescription: "Buttermilk-marinated chicken fillet, spicy mayo, slaw.",
    description: "A whole chicken fillet marinated in buttermilk and spices overnight, fried to order, with spicy mayo and slaw. The one that outsells everything else.",
    image: "1606755962773-d324e0a13086", spiceLevel: 3, calories: 720, prepTimeMinutes: 12,
    variants: [{ name: "Regular", price: 790, cost: 290, isDefault: true }, { name: "Large Fillet", price: 1050, cost: 400 }],
    modifiers: ["add-ons", "spice-level"],
  },
  {
    slug: "smoky-bbq-burger", name: "Smoky BBQ Burger", category: "burgers",
    shortDescription: "Beef patty, smoked BBQ glaze, crispy onions, cheddar.",
    description: "Beef patty brushed with a smoked barbecue glaze, crispy fried onions and cheddar. Sweet, smoky and messy on purpose.",
    image: "1553979459-d2229ba7433b", spiceLevel: 2, calories: 780, prepTimeMinutes: 12,
    variants: [{ name: "Regular", price: 890, cost: 335, isDefault: true }],
    modifiers: ["add-ons"],
  },
  {
    slug: "tower-burger", name: "The Tower", category: "burgers",
    shortDescription: "Beef and chicken stacked, with cheese between every layer.",
    description: "A beef patty and a crispy chicken fillet in the same bun, with cheese between every layer. Ordered more often as a dare than as a meal, and finished more often than you would think.",
    image: "1586190848861-99aa4a171e90", spiceLevel: 2, calories: 1180, prepTimeMinutes: 15,
    variants: [{ name: "Regular", price: 1290, cost: 520, isDefault: true }],
    modifiers: ["add-ons"],
  },

  // --- fried chicken --------------------------------------------------------
  {
    slug: "crispy-chicken-strips", name: "Crispy Chicken Strips", category: "fried-chicken",
    shortDescription: "Five hand-breaded strips with a dip of your choice.",
    description: "Five chicken strips, hand-breaded and fried to order, with your choice of dip.",
    image: "1562967914-608f82629710", spiceLevel: 1, calories: 560, prepTimeMinutes: 12,
    variants: [{ name: "5 pieces", price: 650, cost: 240, isDefault: true }, { name: "8 pieces", price: 950, cost: 370 }],
    modifiers: ["dips"],
  },
  {
    slug: "hot-wings", name: "Hot Wings", category: "fried-chicken",
    shortDescription: "Tossed in our own hot sauce, with a cooling dip.",
    description: "Wings fried crisp and tossed in a hot sauce we make in-house, served with a cooling garlic dip because you will want it.",
    image: "1527477396000-e27163b481c2", spiceLevel: 4, calories: 480, prepTimeMinutes: 14,
    variants: [{ name: "6 pieces", price: 620, cost: 230, isDefault: true }, { name: "12 pieces", price: 1150, cost: 440 }],
    modifiers: ["dips", "spice-level"],
  },
  {
    slug: "chicken-bucket", name: "Chicken Bucket", category: "fried-chicken",
    shortDescription: "Eight pieces of fried chicken, for the table.",
    description: "Eight pieces of bone-in fried chicken, marinated overnight and pressure-fried. Enough for three or four people, or two with no shame.",
    image: "1626082927389-6cd097cdc6ec", spiceLevel: 2, calories: 1840, prepTimeMinutes: 18,
    variants: [{ name: "8 pieces", price: 1890, cost: 760, isDefault: true }, { name: "15 pieces", price: 3290, cost: 1350 }],
    modifiers: ["dips"],
  },

  // --- pizza ----------------------------------------------------------------
  {
    slug: "chicken-tikka-pizza", name: "Chicken Tikka Pizza", category: "pizza",
    shortDescription: "Tikka-spiced chicken, peppers, onion, mozzarella.",
    description: "Chicken marinated in tikka spices with peppers, red onion and plenty of mozzarella. The best-selling pizza in the country, and ours is a good one.",
    image: "1565299624946-b28f40a0ae38", spiceLevel: 3, calories: 1120, prepTimeMinutes: 18,
    variants: [{ name: "Small 9\"", price: 950, cost: 340, isDefault: true }, { name: "Medium 12\"", price: 1490, cost: 540 }, { name: "Family 16\"", price: 2190, cost: 820 }],
    modifiers: ["pizza-extras"],
  },
  {
    slug: "pepperoni-pizza", name: "Pepperoni Pizza", category: "pizza",
    shortDescription: "Beef pepperoni, mozzarella, oregano.",
    description: "Beef pepperoni and mozzarella on our hand-stretched base, finished with oregano.",
    image: "1513104890138-7c749659a591", spiceLevel: 2, calories: 1080, prepTimeMinutes: 18,
    variants: [{ name: "Small 9\"", price: 990, cost: 360, isDefault: true }, { name: "Medium 12\"", price: 1590, cost: 580 }, { name: "Family 16\"", price: 2290, cost: 870 }],
    modifiers: ["pizza-extras"],
  },

  // --- wraps & sandwiches ---------------------------------------------------
  {
    slug: "chicken-wrap", name: "Grilled Chicken Wrap", category: "wraps-sandwiches",
    shortDescription: "Grilled chicken, slaw and garlic sauce in a warm tortilla.",
    description: "Grilled chicken, crunchy slaw and garlic sauce rolled in a warm tortilla. The order that goes out fastest at lunch.",
    image: "1622483767028-3f66f32aef97", spiceLevel: 2, calories: 520, prepTimeMinutes: 8,
    variants: [{ name: "Regular", price: 590, cost: 215, isDefault: true }],
    modifiers: ["add-ons", "spice-level"],
  },
  {
    slug: "club-sandwich", name: "Club Sandwich", category: "wraps-sandwiches",
    shortDescription: "Three layers, chicken, egg, cheese and salad. Fries on the side.",
    description: "The full three-layer club — chicken, egg, cheese, lettuce and tomato on toasted bread, cut into quarters, with fries.",
    image: "1553909489-cd47e0907980", spiceLevel: 0, calories: 760, prepTimeMinutes: 10,
    variants: [{ name: "Regular", price: 740, cost: 275, isDefault: true }],
    modifiers: ["add-ons"],
  },

  // --- sides ----------------------------------------------------------------
  {
    slug: "seasoned-fries", name: "Seasoned Fries", category: "sides",
    shortDescription: "Thick-cut, double-fried, dusted with our own seasoning.",
    description: "Thick-cut potatoes, double-fried so they stay crisp on the way to the table, dusted with our seasoning.",
    image: "1541592106381-b31e9677c0e5", spiceLevel: 1, calories: 380, prepTimeMinutes: 6,
    variants: [{ name: "Regular", price: 290, cost: 85, isDefault: true }, { name: "Large", price: 420, cost: 130 }],
    modifiers: ["dips"],
  },
  {
    slug: "garden-salad", name: "Garden Salad", category: "sides",
    shortDescription: "Leaves, avocado, chickpeas and a lemon dressing.",
    description: "Mixed leaves, avocado, chickpeas, tomato and cucumber with a lemon dressing. On the menu because somebody at every table asks for it.",
    image: "1512621776951-a57141f2eefd", spiceLevel: 0, calories: 290, prepTimeMinutes: 6,
    variants: [{ name: "Regular", price: 490, cost: 180, isDefault: true }],
    modifiers: [],
  },
  {
    slug: "creamy-pasta", name: "Creamy Chicken Pasta", category: "sides",
    shortDescription: "Penne in a white sauce with grilled chicken.",
    description: "Penne in a cream sauce with grilled chicken and herbs, baked with cheese on top.",
    image: "1621996346565-e3dbc646d9a9", spiceLevel: 1, calories: 680, prepTimeMinutes: 14,
    variants: [{ name: "Regular", price: 790, cost: 290, isDefault: true }],
    modifiers: [],
  },

  // --- desserts -------------------------------------------------------------
  {
    slug: "chocolate-fudge-cake", name: "Chocolate Fudge Cake", category: "desserts",
    shortDescription: "A thick slice, warmed, with chocolate sauce.",
    description: "A thick slice of chocolate fudge cake, warmed through, with chocolate sauce poured over.",
    image: "1578985545062-69928b1d9587", spiceLevel: 0, calories: 540, prepTimeMinutes: 5,
    variants: [{ name: "Slice", price: 450, cost: 150, isDefault: true }],
    modifiers: [],
  },
  {
    slug: "brownie-sundae", name: "Brownie Sundae", category: "desserts",
    shortDescription: "Warm brownie, vanilla ice cream, salted caramel.",
    description: "A warm brownie under vanilla ice cream with salted caramel poured at the table.",
    image: "1551024506-0bccd828d307", spiceLevel: 0, calories: 620, prepTimeMinutes: 6,
    variants: [{ name: "Regular", price: 520, cost: 175, isDefault: true }],
    modifiers: [],
  },
  {
    slug: "raspberry-cheesecake", name: "Raspberry Cheesecake", category: "desserts",
    shortDescription: "Baked cheesecake with a raspberry layer.",
    description: "Baked cheesecake with a raspberry layer and fresh berries on top.",
    image: "1565958011703-44f9829ba187", spiceLevel: 0, calories: 480, prepTimeMinutes: 5,
    variants: [{ name: "Slice", price: 540, cost: 190, isDefault: true }],
    modifiers: [],
  },

  // --- drinks ---------------------------------------------------------------
  {
    slug: "soft-drink", name: "Soft Drink", category: "drinks",
    shortDescription: "Served over ice.",
    description: "Your choice of soft drink, served over ice.",
    image: "1626700051175-6818013e1d4f", spiceLevel: 0, calories: 180, prepTimeMinutes: 2,
    variants: [{ name: "Regular", price: 150, cost: 45, isDefault: true }, { name: "Large", price: 220, cost: 70 }],
    modifiers: [],
  },
  {
    slug: "mint-lemonade", name: "Mint Lemonade", category: "drinks",
    shortDescription: "Fresh lime and mint, blended with ice.",
    description: "Fresh lime and mint blended with ice. The thing to order when it is forty degrees outside.",
    image: "1581636625402-29b2a704ef13", spiceLevel: 0, calories: 160, prepTimeMinutes: 4,
    variants: [{ name: "Regular", price: 280, cost: 80, isDefault: true }, { name: "Jug", price: 690, cost: 210 }],
    modifiers: [],
  },
];

/**
 * Shared across products rather than duplicated per item, which is how a real
 * kitchen thinks about them: one "add-ons" list maintained once, attached to
 * everything it applies to.
 */
export const MODIFIER_GROUPS = [
  {
    key: "add-ons", name: "Add-ons", selectionType: "MULTIPLE", minSelect: 0, maxSelect: 5,
    options: [
      { name: "Extra cheese slice", priceDelta: 90 },
      { name: "Extra patty", priceDelta: 320 },
      { name: "Crispy onions", priceDelta: 60 },
      { name: "Jalapeños", priceDelta: 70 },
      { name: "Fried egg", priceDelta: 100 },
    ],
  },
  {
    key: "spice-level", name: "Spice level", selectionType: "SINGLE", minSelect: 1, maxSelect: 1,
    options: [
      { name: "Mild", priceDelta: 0 },
      { name: "Medium", priceDelta: 0, isDefault: true },
      { name: "Hot", priceDelta: 0 },
      { name: "Extra hot", priceDelta: 0 },
    ],
  },
  {
    key: "dips", name: "Choose a dip", selectionType: "SINGLE", minSelect: 1, maxSelect: 1,
    options: [
      { name: "Garlic mayo", priceDelta: 0, isDefault: true },
      { name: "BBQ", priceDelta: 0 },
      { name: "Hot sauce", priceDelta: 0 },
      { name: "Blue cheese", priceDelta: 60 },
    ],
  },
  {
    key: "pizza-extras", name: "Extra toppings", selectionType: "MULTIPLE", minSelect: 0, maxSelect: 4,
    options: [
      { name: "Extra mozzarella", priceDelta: 180 },
      { name: "Olives", priceDelta: 120 },
      { name: "Mushrooms", priceDelta: 140 },
      { name: "Extra chicken", priceDelta: 250 },
    ],
  },
];

/** How the menu is laid out on the storefront, in the order it reads. */
export const MENU_SECTIONS = [
  { name: "Most ordered", slugs: ["zinger-crispy-burger", "chicken-tikka-pizza", "chicken-bucket", "classic-beef-burger"], recommended: true },
  { name: "Burgers", slugs: ["classic-beef-burger", "double-cheese-burger", "zinger-crispy-burger", "smoky-bbq-burger", "tower-burger"] },
  { name: "Fried Chicken", slugs: ["crispy-chicken-strips", "hot-wings", "chicken-bucket"] },
  { name: "Pizza", slugs: ["chicken-tikka-pizza", "pepperoni-pizza"] },
  { name: "Wraps & Sandwiches", slugs: ["chicken-wrap", "club-sandwich"] },
  { name: "Sides", slugs: ["seasoned-fries", "garden-salad", "creamy-pasta"] },
  { name: "Desserts", slugs: ["chocolate-fudge-cake", "brownie-sundae", "raspberry-cheesecake"] },
  { name: "Drinks", slugs: ["soft-drink", "mint-lemonade"] },
];

export const PRODUCT_IMAGE = (id) => photo(id);
