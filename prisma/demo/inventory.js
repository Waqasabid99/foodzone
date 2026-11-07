/**
 * The store room, and what each dish takes out of it.
 *
 * This is the part of the system a restaurant owner tests hardest, because it
 * answers the question their spreadsheet cannot: *what does this burger
 * actually cost me, and what is left on the shelf tonight?* A demo that shows
 * a menu and a revenue chart shows software; a demo that shows a Zinger
 * costing Rs 243 in ingredients against Rs 790 on the menu shows a business.
 *
 * Costs are Karachi wholesale rates as of late 2026, per the unit named. They
 * are not exact — nobody's are — but they are close enough that an owner
 * reading them recognises their own invoices rather than dismissing the
 * screen.
 */

export const UNITS = [
  { code: "kg", name: "Kilogram", type: "WEIGHT", precision: 3 },
  { code: "g", name: "Gram", type: "WEIGHT", base: "kg", factor: 0.001, precision: 0 },
  { code: "l", name: "Litre", type: "VOLUME", precision: 3 },
  { code: "ml", name: "Millilitre", type: "VOLUME", base: "l", factor: 0.001, precision: 0 },
  { code: "pc", name: "Piece", type: "COUNT", precision: 0 },
];

export const ITEM_CATEGORIES = [
  { code: "MEAT", name: "Meat and poultry" },
  { code: "PROD", name: "Fresh produce" },
  { code: "DAIRY", name: "Dairy" },
  { code: "DRY", name: "Dry goods" },
  { code: "BEV", name: "Beverages" },
  { code: "PACK", name: "Packaging" },
];

/**
 * `cost` is per the item's own unit, which is the unit it is bought and
 * counted in — mince by the kilo, buns by the piece.
 *
 * `perishable` items get a shelf life, so the expiring-stock report and the
 * batch screens have something real to show rather than an empty table.
 */
export const ITEMS = [
  { sku: "RAW-BEEF-MINCE", name: "Beef mince (80/20)", category: "MEAT", uom: "kg", cost: 1250, perishable: 3, reorder: 15, opening: 42 },
  { sku: "RAW-CHKN-FILLET", name: "Chicken fillet", category: "MEAT", uom: "kg", cost: 780, perishable: 3, reorder: 20, opening: 56 },
  { sku: "RAW-CHKN-WINGS", name: "Chicken wings", category: "MEAT", uom: "kg", cost: 620, perishable: 3, reorder: 12, opening: 28 },
  { sku: "RAW-CHKN-WHOLE", name: "Chicken, bone-in pieces", category: "MEAT", uom: "kg", cost: 540, perishable: 3, reorder: 20, opening: 45 },
  { sku: "RAW-PEPPERONI", name: "Beef pepperoni", category: "MEAT", uom: "kg", cost: 1850, perishable: 21, reorder: 4, opening: 9 },

  { sku: "RAW-POTATO", name: "Potatoes", category: "PROD", uom: "kg", cost: 95, perishable: 21, reorder: 30, opening: 85 },
  { sku: "RAW-LETTUCE", name: "Iceberg lettuce", category: "PROD", uom: "kg", cost: 180, perishable: 5, reorder: 6, opening: 11 },
  { sku: "RAW-TOMATO", name: "Tomatoes", category: "PROD", uom: "kg", cost: 140, perishable: 7, reorder: 8, opening: 16 },
  { sku: "RAW-ONION", name: "Onions", category: "PROD", uom: "kg", cost: 110, perishable: 30, reorder: 10, opening: 24 },
  { sku: "RAW-LEMON", name: "Lemons", category: "PROD", uom: "kg", cost: 260, perishable: 14, reorder: 4, opening: 7 },
  { sku: "RAW-MINT", name: "Fresh mint", category: "PROD", uom: "kg", cost: 320, perishable: 4, reorder: 1, opening: 2 },
  { sku: "RAW-AVOCADO", name: "Avocado", category: "PROD", uom: "pc", cost: 180, perishable: 7, reorder: 10, opening: 22 },

  { sku: "RAW-CHEDDAR", name: "Cheddar slices", category: "DAIRY", uom: "kg", cost: 1650, perishable: 30, reorder: 5, opening: 12 },
  { sku: "RAW-MOZZARELLA", name: "Mozzarella", category: "DAIRY", uom: "kg", cost: 1480, perishable: 21, reorder: 6, opening: 15 },
  { sku: "RAW-CREAM", name: "Cooking cream", category: "DAIRY", uom: "l", cost: 620, perishable: 14, reorder: 4, opening: 9 },
  { sku: "RAW-ICECREAM", name: "Vanilla ice cream", category: "DAIRY", uom: "l", cost: 540, perishable: 60, reorder: 5, opening: 11 },

  { sku: "RAW-BUN", name: "Brioche burger bun", category: "DRY", uom: "pc", cost: 38, perishable: 4, reorder: 150, opening: 420 },
  { sku: "RAW-TORTILLA", name: "Tortilla wrap", category: "DRY", uom: "pc", cost: 26, perishable: 7, reorder: 80, opening: 180 },
  { sku: "RAW-PIZZA-DOUGH", name: "Pizza dough ball", category: "DRY", uom: "pc", cost: 85, perishable: 3, reorder: 40, opening: 96 },
  { sku: "RAW-FLOUR", name: "Flour", category: "DRY", uom: "kg", cost: 160, reorder: 20, opening: 55 },
  { sku: "RAW-OIL", name: "Frying oil", category: "DRY", uom: "l", cost: 480, reorder: 25, opening: 70 },
  { sku: "RAW-PIZZA-SAUCE", name: "Pizza sauce", category: "DRY", uom: "kg", cost: 420, perishable: 30, reorder: 5, opening: 12 },
  { sku: "RAW-MAYO", name: "Mayonnaise", category: "DRY", uom: "kg", cost: 520, perishable: 60, reorder: 6, opening: 14 },
  { sku: "RAW-CHOC-CAKE", name: "Chocolate fudge cake", category: "DRY", uom: "pc", cost: 2400, perishable: 5, reorder: 2, opening: 5 },
  { sku: "RAW-CHEESECAKE", name: "Raspberry cheesecake", category: "DRY", uom: "pc", cost: 2800, perishable: 5, reorder: 2, opening: 4 },
  { sku: "RAW-BROWNIE", name: "Brownie", category: "DRY", uom: "pc", cost: 110, perishable: 10, reorder: 20, opening: 48 },
  { sku: "RAW-PENNE", name: "Penne pasta", category: "DRY", uom: "kg", cost: 390, reorder: 8, opening: 18 },

  { sku: "BEV-COLA", name: "Cola concentrate", category: "BEV", uom: "l", cost: 340, reorder: 10, opening: 26 },
  { sku: "BEV-SUGAR", name: "Sugar", category: "BEV", uom: "kg", cost: 165, reorder: 15, opening: 38 },

  { sku: "PACK-BURGER-BOX", name: "Burger box", category: "PACK", uom: "pc", cost: 14, reorder: 300, opening: 850 },
  { sku: "PACK-PIZZA-BOX", name: "Pizza box", category: "PACK", uom: "pc", cost: 32, reorder: 150, opening: 420 },
  { sku: "PACK-FRIES-SLEEVE", name: "Fries sleeve", category: "PACK", uom: "pc", cost: 7, reorder: 400, opening: 1100 },
  { sku: "PACK-CUP", name: "Drink cup with lid", category: "PACK", uom: "pc", cost: 11, reorder: 400, opening: 960 },
  { sku: "PACK-BAG", name: "Carry bag", category: "PACK", uom: "pc", cost: 9, reorder: 300, opening: 780 },
];

export const SUPPLIERS = [
  { code: "SUP-METRO", name: "Metro Cash & Carry", contact: "Sales desk", phone: "+92 21 111 222 333", terms: 14 },
  { code: "SUP-ALKAR", name: "Al-Karam Poultry", contact: "Rizwan", phone: "+92 300 8881122", terms: 7 },
  { code: "SUP-FRESH", name: "Fresh Valley Produce", contact: "Asif", phone: "+92 321 7742210", terms: 7 },
  { code: "SUP-PACK", name: "PackRight Supplies", contact: "Hina", phone: "+92 333 6610099", terms: 30 },
];

/**
 * What a dish takes out of the store, per portion.
 *
 * These are the numbers that produce a food cost, and therefore the margin
 * column everywhere else. Quantities are in the unit named, which is usually
 * grams or millilitres even though the item is bought by the kilo or litre —
 * that conversion is the system's job, and getting it visibly right is part
 * of the demonstration.
 */
export const RECIPES = [
  { product: "classic-beef-burger", yield: 1, ingredients: [["RAW-BEEF-MINCE", 120, "g"], ["RAW-BUN", 1, "pc"], ["RAW-CHEDDAR", 20, "g"], ["RAW-LETTUCE", 20, "g"], ["RAW-TOMATO", 25, "g"], ["RAW-MAYO", 15, "g"], ["PACK-BURGER-BOX", 1, "pc"]] },
  { product: "double-cheese-burger", yield: 1, ingredients: [["RAW-BEEF-MINCE", 240, "g"], ["RAW-BUN", 1, "pc"], ["RAW-CHEDDAR", 40, "g"], ["RAW-ONION", 20, "g"], ["RAW-MAYO", 15, "g"], ["PACK-BURGER-BOX", 1, "pc"]] },
  { product: "zinger-crispy-burger", yield: 1, ingredients: [["RAW-CHKN-FILLET", 150, "g"], ["RAW-BUN", 1, "pc"], ["RAW-FLOUR", 40, "g"], ["RAW-OIL", 30, "ml"], ["RAW-LETTUCE", 20, "g"], ["RAW-MAYO", 20, "g"], ["PACK-BURGER-BOX", 1, "pc"]] },
  { product: "smoky-bbq-burger", yield: 1, ingredients: [["RAW-BEEF-MINCE", 120, "g"], ["RAW-BUN", 1, "pc"], ["RAW-CHEDDAR", 20, "g"], ["RAW-ONION", 30, "g"], ["RAW-MAYO", 15, "g"], ["PACK-BURGER-BOX", 1, "pc"]] },
  { product: "tower-burger", yield: 1, ingredients: [["RAW-BEEF-MINCE", 120, "g"], ["RAW-CHKN-FILLET", 140, "g"], ["RAW-BUN", 1, "pc"], ["RAW-CHEDDAR", 40, "g"], ["RAW-FLOUR", 35, "g"], ["RAW-OIL", 30, "ml"], ["PACK-BURGER-BOX", 1, "pc"]] },
  { product: "crispy-chicken-strips", yield: 1, ingredients: [["RAW-CHKN-FILLET", 180, "g"], ["RAW-FLOUR", 50, "g"], ["RAW-OIL", 40, "ml"], ["RAW-MAYO", 25, "g"], ["PACK-FRIES-SLEEVE", 1, "pc"]] },
  { product: "hot-wings", yield: 1, ingredients: [["RAW-CHKN-WINGS", 320, "g"], ["RAW-FLOUR", 30, "g"], ["RAW-OIL", 40, "ml"], ["RAW-MAYO", 25, "g"], ["PACK-FRIES-SLEEVE", 1, "pc"]] },
  { product: "chicken-bucket", yield: 1, ingredients: [["RAW-CHKN-WHOLE", 1200, "g"], ["RAW-FLOUR", 180, "g"], ["RAW-OIL", 120, "ml"], ["PACK-BAG", 1, "pc"]] },
  { product: "chicken-tikka-pizza", yield: 1, ingredients: [["RAW-PIZZA-DOUGH", 1, "pc"], ["RAW-PIZZA-SAUCE", 90, "g"], ["RAW-MOZZARELLA", 150, "g"], ["RAW-CHKN-FILLET", 110, "g"], ["RAW-ONION", 30, "g"], ["PACK-PIZZA-BOX", 1, "pc"]] },
  { product: "pepperoni-pizza", yield: 1, ingredients: [["RAW-PIZZA-DOUGH", 1, "pc"], ["RAW-PIZZA-SAUCE", 90, "g"], ["RAW-MOZZARELLA", 160, "g"], ["RAW-PEPPERONI", 70, "g"], ["PACK-PIZZA-BOX", 1, "pc"]] },
  { product: "chicken-wrap", yield: 1, ingredients: [["RAW-TORTILLA", 1, "pc"], ["RAW-CHKN-FILLET", 120, "g"], ["RAW-LETTUCE", 25, "g"], ["RAW-MAYO", 20, "g"], ["PACK-BAG", 1, "pc"]] },
  { product: "seasoned-fries", yield: 1, ingredients: [["RAW-POTATO", 250, "g"], ["RAW-OIL", 35, "ml"], ["PACK-FRIES-SLEEVE", 1, "pc"]] },
  { product: "garden-salad", yield: 1, ingredients: [["RAW-LETTUCE", 90, "g"], ["RAW-TOMATO", 60, "g"], ["RAW-AVOCADO", 1, "pc"], ["RAW-ONION", 20, "g"]] },
  { product: "creamy-pasta", yield: 1, ingredients: [["RAW-PENNE", 160, "g"], ["RAW-CREAM", 120, "ml"], ["RAW-CHKN-FILLET", 90, "g"], ["RAW-MOZZARELLA", 40, "g"]] },
  { product: "brownie-sundae", yield: 1, ingredients: [["RAW-BROWNIE", 1, "pc"], ["RAW-ICECREAM", 120, "ml"]] },
  { product: "mint-lemonade", yield: 1, ingredients: [["RAW-LEMON", 90, "g"], ["RAW-MINT", 8, "g"], ["BEV-SUGAR", 35, "g"], ["PACK-CUP", 1, "pc"]] },
  { product: "soft-drink", yield: 1, ingredients: [["BEV-COLA", 60, "ml"], ["BEV-SUGAR", 20, "g"], ["PACK-CUP", 1, "pc"]] },
];
