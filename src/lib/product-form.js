/**
 * Product form state <-> API bodies, and the "is this actually on sale?" rule.
 *
 * Money is the part that needs care. It is typed as text, sent as a number and
 * stored as Decimal(18,4); the server rejects more than four decimal places and
 * anything negative. A price box is also where people type "1,200" — so the
 * parse accepts thousands separators, and refuses anything it cannot read with
 * certainty rather than guessing. A guessed price is a wrong price.
 */

export const DIETARY_TAGS = [
  { value: "VEG", label: "Vegetarian" },
  { value: "NON_VEG", label: "Non-vegetarian" },
  { value: "VEGAN", label: "Vegan" },
  { value: "EGG", label: "Contains egg" },
  { value: "HALAL", label: "Halal" },
  { value: "JAIN", label: "Jain" },
  { value: "GLUTEN_FREE", label: "Gluten free" },
];

/** The list filter's statuses. Here, not in the client component, so a server page can read them. */
export const PRODUCT_STATUSES = [
  { value: "all", label: "All products" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "deleted", label: "Deleted" },
];

export const SPICE_LEVELS = [
  { value: "", label: "Not spicy / not stated" },
  { value: "1", label: "1 — Mild" },
  { value: "2", label: "2 — Medium" },
  { value: "3", label: "3 — Hot" },
  { value: "4", label: "4 — Very hot" },
  { value: "5", label: "5 — Extreme" },
];

/** Fields `toFormErrors` may pin a message to on the details form. */
export const PRODUCT_FIELDS = [
  "name",
  "slug",
  "categoryId",
  "shortDescription",
  "description",
  "imageUrl",
  "price",
  "variants",
  "spiceLevel",
  "allergens",
  "calories",
  "prepTimeMinutes",
  "stationId",
  "taxGroupId",
];

const MONEY_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;

/**
 * "1,200.50" -> 1200.5. Returns `{ value }` or `{ error }`; blank is `{ value: null }`.
 *
 * Commas are accepted only as thousands separators (groups of three), so
 * "3,50" — a European decimal — is refused instead of becoming 350.
 */
export function parseMoney(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { value: null };

  if (raw.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) {
    return { error: "Use a full stop for decimals, e.g. 1200.50" };
  }
  const plain = raw.replace(/,/g, "");
  if (plain.startsWith("-")) return { error: "A price cannot be negative" };
  if (!/^\d+(\.\d+)?$/.test(plain)) return { error: "Enter a number, e.g. 850" };
  if (!MONEY_PATTERN.test(plain)) return { error: "Use at most 4 decimal places" };

  return { value: Number(plain) };
}

/**
 * A price *adjustment*, which may be negative: "No cheese, −50". Accepts a
 * leading "-", "+" or the typographic minus people paste from documents.
 */
export function parseMoneyDelta(input) {
  const raw = String(input ?? "").trim().replace(/^\u2212/, "-");
  if (!raw) return { value: null };
  const sign = raw.startsWith("-") ? -1 : 1;
  const parsed = parseMoney(raw.replace(/^[-+]\s*/, ""));
  if (parsed.error) return parsed;
  return { value: parsed.value === 0 ? 0 : sign * parsed.value };
}

/** A whole number within bounds, or null when blank. */
export function parseWhole(input, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(input ?? "").trim();
  if (!raw) return { value: null };
  if (!/^\d+$/.test(raw)) return { error: "Enter a whole number" };
  const value = Number(raw);
  if (value < min || value > max) return { error: `Between ${min} and ${max}` };
  return { value };
}

/** "peanuts, dairy,, Gluten " -> ["peanuts", "dairy", "Gluten"], without duplicates. */
export function parseList(input) {
  const seen = new Set();
  return String(input ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function productFormValues(product = null) {
  const text = (value) => (value === null || value === undefined ? "" : String(value));
  return {
    name: text(product?.name),
    slug: text(product?.slug),
    categoryId: text(product?.categoryId),
    // Empty means the whole chain's catalogue, which is the default and the
    // only possibility for a single-restaurant installation.
    branchId: text(product?.branchId),
    shortDescription: text(product?.shortDescription),
    description: text(product?.description),
    imageUrl: text(product?.imageUrl),
    dietary: product?.dietary ?? [],
    spiceLevel: product?.spiceLevel ? String(product.spiceLevel) : "",
    allergens: (product?.allergens ?? []).join(", "),
    calories: text(product?.calories),
    // The database default, shown rather than hidden behind a blank box.
    prepTimeMinutes: product ? text(product.prepTimeMinutes) : "15",
    stationId: text(product?.stationId),
    taxGroupId: text(product?.taxGroupId),
    isFeatured: Boolean(product?.isFeatured),
    // Create only: one price, or a list of sizes.
    pricing: "single",
    price: "",
    sizes: [
      { key: "s1", name: "Regular", price: "" },
      { key: "s2", name: "Large", price: "" },
    ],
    defaultSize: "s1",
  };
}

/**
 * The body for create or update, plus any errors found on the way.
 *
 * Returns `{ body, errors }`. When `errors` is non-empty nothing should be sent:
 * these are the mistakes the browser can see for certain, reported beside the
 * fields that caused them.
 */
export function productPayload(form, { original = null } = {}) {
  const errors = {};
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const creating = !original;

  if (!text(form.name)) errors.name = "Give the product a name";
  if (!text(form.categoryId)) errors.categoryId = "Choose a category";

  const calories = parseWhole(form.calories, { max: 20000 });
  if (calories.error) errors.calories = calories.error;
  const prep = parseWhole(form.prepTimeMinutes, { max: 1440 });
  if (prep.error) errors.prepTimeMinutes = prep.error;
  // The column has no "unknown": it feeds ready-time estimates. A blank box
  // is refused rather than quietly keeping whatever was there before.
  else if (prep.value === null) errors.prepTimeMinutes = "Enter how many minutes it takes to prepare";

  const body = {
    name: text(form.name),
    categoryId: text(form.categoryId),
    // Null is meaningful here: it is the chain's catalogue, not "unset". Sent
    // explicitly so moving a product back to the whole chain actually saves.
    branchId: text(form.branchId) || null,
    shortDescription: text(form.shortDescription) || null,
    description: text(form.description) || null,
    imageUrl: text(form.imageUrl) || null,
    dietary: [...new Set(form.dietary ?? [])],
    spiceLevel: form.spiceLevel ? Number(form.spiceLevel) : null,
    allergens: parseList(form.allergens),
    calories: calories.value ?? null,
    stationId: text(form.stationId) || null,
    taxGroupId: text(form.taxGroupId) || null,
    isFeatured: Boolean(form.isFeatured),
  };
  if (prep.value !== null) body.prepTimeMinutes = prep.value;

  // Only sent when changed on edit, so saving never renames a saved link.
  const slug = text(form.slug);
  if (slug && slug !== (original?.slug ?? "")) body.slug = slug;

  if (creating) {
    if (form.pricing === "single") {
      const price = parseMoney(form.price);
      if (price.error) errors.price = price.error;
      else if (price.value === null) errors.price = "Enter a price";
      else body.price = price.value;
    } else {
      const sizes = (form.sizes ?? []).filter((size) => text(size.name) || text(size.price));
      const sizeErrors = [];
      const names = new Set();

      const variants = sizes.map((size, index) => {
        const price = parseMoney(size.price);
        const name = text(size.name);
        if (!name) sizeErrors.push(`Size ${index + 1} needs a name`);
        else if (names.has(name.toLowerCase())) sizeErrors.push(`"${name}" is listed twice`);
        names.add(name.toLowerCase());
        if (price.error) sizeErrors.push(`${name || `Size ${index + 1}`}: ${price.error}`);
        else if (price.value === null) sizeErrors.push(`${name || `Size ${index + 1}`} needs a price`);
        return { name, price: price.value, isDefault: size.key === form.defaultSize, sortOrder: index };
      });

      if (variants.length < 2) sizeErrors.push("List at least two sizes, or switch to a single price");
      if (variants.length && !variants.some((variant) => variant.isDefault)) variants[0].isDefault = true;

      if (sizeErrors.length) errors.variants = sizeErrors[0];
      else body.variants = variants;
    }
  }

  return { body, errors };
}

/** Variant row state <-> PATCH/POST body for the sizes editor. */
export function variantFormValues(variant = null) {
  const text = (value) => (value === null || value === undefined ? "" : String(value));
  return {
    name: text(variant?.name),
    price: text(variant?.price),
    compareAtPrice: text(variant?.compareAtPrice),
    sku: text(variant?.sku),
    servingSize: text(variant?.servingSize),
  };
}

export function variantPayload(form, { creating = false } = {}) {
  const errors = {};
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  const name = text(form.name);
  if (!name) errors.name = "Name this size";

  const price = parseMoney(form.price);
  if (price.error) errors.price = price.error;
  else if (price.value === null) errors.price = "Enter a price";

  const compare = parseMoney(form.compareAtPrice);
  if (compare.error) errors.compareAtPrice = compare.error;
  // A "was" price at or below the price shows a discount that is not one.
  else if (compare.value !== null && price.value !== null && compare.value <= price.value) {
    errors.compareAtPrice = "The 'was' price must be higher than the price";
  }

  const body = {
    name,
    price: price.value,
    compareAtPrice: compare.value,
    servingSize: text(form.servingSize) || null,
  };
  // A blank SKU on create lets the server generate one; on edit a SKU cannot be
  // emptied — it is printed on labels and purchase orders — so blank means keep.
  const sku = text(form.sku);
  if (sku) body.sku = sku;
  if (creating && body.compareAtPrice === null) delete body.compareAtPrice;

  return { body, errors };
}

/**
 * Why a product is, or is not, something a customer can buy right now.
 *
 * Four independent switches decide it, owned by different screens and often
 * different people: the product's own publish state, its category's
 * visibility, having an active size, and being placed on an active menu.
 * Publishing is not selling. The first unmet condition is reported, because
 * that is the next thing someone has to do.
 */
export function productSaleState(product, menus = [], { comboIssues = [] } = {}) {
  if (product.deletedAt) {
    return { key: "DELETED", label: "Deleted", detail: "Removed from every menu. Restore it to edit it again." };
  }
  if (!product.isActive) {
    return { key: "DRAFT", label: "Draft", detail: "Not visible to customers until it is published." };
  }
  if (product.category && product.category.isActive === false) {
    return {
      key: "CATEGORY_HIDDEN",
      label: "Category hidden",
      detail: `Published, but its category "${product.category.name}" is hidden, so customers cannot find it.`,
    };
  }
  const blocking = comboIssues.find((issue) => issue.level === "blocking");
  if (blocking) {
    return { key: "COMBO_INCOMPLETE", label: "Cannot be ordered", detail: blocking.message };
  }
  const liveMenus = menus.filter((menu) => menu.isActive);
  if (!liveMenus.length) {
    return {
      key: "NOT_ON_MENU",
      label: "Not on a menu",
      detail: menus.length
        ? "Published, but every menu it is on is switched off, so it cannot be ordered."
        : "Published, but it cannot be ordered until it is added to a branch menu.",
    };
  }
  return {
    key: "ON_SALE",
    label: "On sale",
    detail: `On ${liveMenus.length} active ${liveMenus.length === 1 ? "menu" : "menus"}.`,
  };
}

/**
 * The menus a product could be put on, given where it is sold.
 *
 * A branch-scoped product is only in that branch's catalogue, so another
 * branch's menu is not a choice — it is a way to create a placement the
 * storefront will then refuse to show, which reads as "I added it and nothing
 * happened". No branch means chain-wide, and chain-wide can go anywhere.
 */
export function menusForBranch(menus, branchId) {
  if (!branchId) return menus ?? [];
  return (menus ?? []).filter((menu) => menu.branchId === branchId);
}
