/**
 * What a catalog CSV may contain, and how each cell becomes a value.
 *
 * Two decisions shape this file:
 *
 *   * **Every resource has a natural key** — a category's slug, a product's
 *     slug, a variant's SKU. That is what makes the feature a round-trip rather
 *     than a one-way dump: exporting, editing two cells in a spreadsheet and
 *     importing again updates those rows instead of creating duplicates of
 *     everything. Database ids are deliberately absent from the format; they
 *     mean nothing to the person editing the file and invite an import run
 *     against the wrong environment.
 *
 *   * **A blank cell means "leave it alone", not "set it to empty"** on an
 *     update. A spreadsheet round-trip drops columns and blanks cells all the
 *     time; treating that as an instruction to wipe every description would be
 *     a data-loss machine. Clearing a value is therefore explicit, with `--`.
 *
 * Parsing is pure, so every awkward cell — a price with a currency symbol, a
 * boolean spelled "Yes", a list with stray spacing — is unit-tested without a
 * database.
 */

/** The token that means "clear this field", since blank means "unchanged". */
export const CLEAR = "--";

const TRUE_WORDS = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "0"]);

export function parseBoolean(raw, { field }) {
  const text = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return { value: true };
  if (FALSE_WORDS.has(text)) return { value: false };
  return { error: `${field}: expected yes or no, got "${raw}"` };
}

export function parseInteger(raw, { field, min = null, max = null }) {
  const text = String(raw).trim();
  if (!/^-?\d+$/.test(text)) return { error: `${field}: expected a whole number, got "${raw}"` };

  const value = Number(text);
  if (min !== null && value < min) return { error: `${field}: must be at least ${min}` };
  if (max !== null && value > max) return { error: `${field}: must be at most ${max}` };
  return { value };
}

/**
 * Money, kept as a string all the way to `Prisma.Decimal`.
 *
 * Never through `Number`: 19.99 has no exact binary representation, and a
 * catalog import is precisely where a rounding error becomes a price. A leading
 * currency symbol and thousands separators are stripped, because that is what a
 * spreadsheet cell formatted as currency exports as.
 */
export function parseMoney(raw, { field, min = 0 }) {
  const text = String(raw)
    .trim()
    .replace(/^[^\d\-.]+/, "")
    .replaceAll(",", "");

  if (!/^-?\d+(\.\d+)?$/.test(text)) return { error: `${field}: expected an amount, got "${raw}"` };
  if (text.split(".")[1]?.length > 4) return { error: `${field}: at most 4 decimal places` };
  if (min !== null && Number(text) < min) return { error: `${field}: must not be below ${min}` };

  return { value: text };
}

/** Pipe-separated, because a comma inside a CSV cell is a quoting trap. */
export function parseList(raw, { field, allowed = null }) {
  const parts = String(raw)
    .split("|")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  if (allowed) {
    const unknown = parts.filter((part) => !allowed.includes(part));
    if (unknown.length) {
      return { error: `${field}: unknown value${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}` };
    }
  }

  return { value: [...new Set(parts)] };
}

export function parseEnum(raw, { field, allowed }) {
  const text = String(raw).trim().toUpperCase();
  if (!allowed.includes(text)) return { error: `${field}: expected one of ${allowed.join(", ")}` };
  return { value: text };
}

export function parseText(raw, { field, max = 500 }) {
  const text = String(raw).trim();
  if (text.length > max) return { error: `${field}: longer than ${max} characters` };
  return { value: text };
}

export function parseSlug(raw, { field }) {
  const text = String(raw).trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) {
    return { error: `${field}: use lowercase letters, numbers and hyphens, got "${raw}"` };
  }
  if (text.length > 140) return { error: `${field}: longer than 140 characters` };
  return { value: text };
}

const DIETARY = ["VEG", "NON_VEG", "VEGAN", "EGG", "HALAL", "JAIN", "GLUTEN_FREE"];
const PRODUCT_TYPES = ["SIMPLE", "VARIANT", "COMBO"];

const column = (name, parse, options = {}) => ({ name, parse, ...options });

/**
 * The importable resources.
 *
 * `key` is the natural key; `required` columns must appear in the header and be
 * non-blank on any row that creates a record.
 */
export const RESOURCES = {
  categories: {
    label: "Categories",
    key: "slug",
    columns: [
      column("slug", parseSlug, { required: true }),
      column("name", parseText, { required: true, max: 140 }),
      column("description", parseText, { max: 2000, clearable: true }),
      column("parent_slug", parseSlug, { clearable: true }),
      column("image_url", parseText, { max: 2000, clearable: true }),
      column("sort_order", parseInteger, { min: 0, max: 100000 }),
      column("is_active", parseBoolean),
    ],
  },

  products: {
    label: "Products",
    key: "slug",
    columns: [
      column("slug", parseSlug, { required: true }),
      column("name", parseText, { required: true, max: 200 }),
      column("category_slug", parseSlug, { required: true }),
      column("type", parseEnum, { allowed: PRODUCT_TYPES }),
      // Convenience for the common case: sets the default variant's price, so a
      // simple product is one row here rather than a row here and a row in
      // variants.
      column("price", parseMoney),
      column("description", parseText, { max: 5000, clearable: true }),
      column("short_description", parseText, { max: 500, clearable: true }),
      column("station_code", parseText, { max: 40, clearable: true }),
      column("tax_group", parseText, { max: 140, clearable: true }),
      column("dietary", parseList, { allowed: DIETARY, clearable: true }),
      column("allergens", parseList, { clearable: true }),
      column("spice_level", parseInteger, { min: 0, max: 5, clearable: true }),
      column("calories", parseInteger, { min: 0, max: 100000, clearable: true }),
      column("prep_time_minutes", parseInteger, { min: 0, max: 600 }),
      column("image_url", parseText, { max: 2000, clearable: true }),
      column("sort_order", parseInteger, { min: 0, max: 100000 }),
      column("is_active", parseBoolean),
      column("is_featured", parseBoolean),
    ],
  },

  variants: {
    label: "Product variants",
    key: "sku",
    columns: [
      column("sku", parseText, { required: true, max: 64 }),
      column("product_slug", parseSlug, { required: true }),
      column("name", parseText, { required: true, max: 140 }),
      column("price", parseMoney, { required: true }),
      column("compare_at_price", parseMoney, { clearable: true }),
      column("barcode", parseText, { max: 64, clearable: true }),
      column("serving_size", parseText, { max: 64, clearable: true }),
      column("is_default", parseBoolean),
      column("is_active", parseBoolean),
      column("sort_order", parseInteger, { min: 0, max: 100000 }),
    ],
  },

  "menu-items": {
    label: "Menu items",
    // Four columns together identify the row; see `keyOf`.
    key: "branch_code+menu_slug+product_slug+variant_sku",
    columns: [
      column("branch_code", parseText, { required: true, max: 40 }),
      column("menu_slug", parseSlug, { required: true }),
      column("product_slug", parseSlug, { required: true }),
      // Blank means the product's default variant, which is what a simple
      // product's row looks like on export.
      column("variant_sku", parseText, { max: 64 }),
      column("section_name", parseText, { max: 140, clearable: true }),
      column("price_override", parseMoney, { clearable: true }),
      column("is_recommended", parseBoolean),
      column("sort_order", parseInteger, { min: 0, max: 100000 }),
    ],
  },
};

export function resourceNames() {
  return Object.keys(RESOURCES);
}

export function columnNames(resource) {
  return RESOURCES[resource].columns.map((entry) => entry.name);
}

/** The natural key of one parsed row, used to match it against what exists. */
export function keyOf(resource, values) {
  if (resource === "menu-items") {
    return [values.branch_code, values.menu_slug, values.product_slug, values.variant_sku ?? ""].join(" ");
  }
  return values[RESOURCES[resource].key];
}

/**
 * Turns one CSV record into typed values, collecting every problem in the row
 * rather than stopping at the first.
 *
 * Someone fixing a 500-row import wants the whole list, not five hundred
 * successive attempts.
 */
export function coerceRow(resource, record) {
  const spec = RESOURCES[resource];
  if (!spec) return { errors: [`Unknown resource "${resource}"`] };

  const values = {};
  const cleared = [];
  const errors = [];

  for (const entry of spec.columns) {
    const raw = record[entry.name];

    if (raw === undefined || raw === "") {
      if (entry.required) errors.push(`${entry.name}: required`);
      continue;
    }

    if (raw === CLEAR) {
      if (!entry.clearable) errors.push(`${entry.name}: cannot be cleared`);
      else {
        cleared.push(entry.name);
        values[entry.name] = null;
      }
      continue;
    }

    const result = entry.parse(raw, { ...entry, field: entry.name });
    if (result.error) errors.push(result.error);
    else values[entry.name] = result.value;
  }

  return { values, cleared, errors };
}

/**
 * Checks the header before any row is read.
 *
 * A missing key column means every row would look like a create, so the file is
 * refused outright rather than importing a duplicate catalog. Unknown columns
 * are reported but tolerated: spreadsheets accumulate notes columns, and
 * failing on one would be needlessly strict.
 */
export function validateHeaders(resource, headers) {
  const spec = RESOURCES[resource];
  if (!spec) return { errors: [`Unknown resource "${resource}"`], unknown: [] };

  const known = new Set(columnNames(resource));
  const present = new Set(headers);
  const errors = [];

  for (const entry of spec.columns) {
    if (entry.required && !present.has(entry.name)) errors.push(`Missing required column "${entry.name}"`);
  }

  return { errors, unknown: headers.filter((header) => !known.has(header)) };
}
