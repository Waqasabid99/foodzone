import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { withTransaction } from "@/server/utils/db";
import { slugify } from "@/lib/slug";
import { toCsv, parseCsvRecords } from "@/server/catalog/csv";
import { RESOURCES, coerceRow, columnNames, keyOf, validateHeaders } from "@/server/catalog/import-spec";

/**
 * Bulk catalog import and export.
 *
 * The whole point is the **round trip**: what `exportResource` writes is
 * exactly what `importResource` reads, so the workflow is export → edit in a
 * spreadsheet → import, and importing an untouched export is a no-op. That is
 * why every row is identified by a natural key (slug, SKU) rather than a
 * database id — see `import-spec.js`.
 *
 * Two safety properties matter more than throughput here:
 *
 *   * **All or nothing.** Every row is validated and resolved before anything
 *     is written, and the writes happen in one transaction. A catalog half
 *     imported — new prices on some products, old prices on others — is worse
 *     than an import that failed, because nobody can tell by looking which is
 *     which.
 *   * **Nothing is ever deleted.** A row missing from the file means "not
 *     mentioned", never "remove it". Deletion stays a deliberate act through
 *     the normal endpoints; a dropped spreadsheet row must not be able to
 *     retire a product that is on a live menu.
 *
 * `dryRun` produces the identical report without writing, and is the intended
 * first step for any file a person did not generate five minutes earlier.
 */

const MAX_ROWS = 5000;

// --- export -----------------------------------------------------------------

/** Turns a stored value into the cell the importer will read back. */
function cell(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("|");
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

const EXPORTERS = {
  async categories() {
    const rows = await prisma.category.findMany({
      select: {
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        sortOrder: true,
        isActive: true,
        parent: { select: { slug: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      description: cell(row.description),
      parent_slug: cell(row.parent?.slug ?? null),
      image_url: cell(row.imageUrl),
      sort_order: row.sortOrder,
      is_active: cell(row.isActive),
    }));
  },

  async products() {
    const rows = await prisma.product.findMany({
      // Soft-deleted products are left out: exporting them would put rows in
      // the file that re-import as live products, quietly undoing a deletion.
      where: { deletedAt: null },
      select: {
        slug: true,
        name: true,
        description: true,
        shortDescription: true,
        type: true,
        imageUrl: true,
        dietary: true,
        allergens: true,
        spiceLevel: true,
        calories: true,
        prepTimeMinutes: true,
        sortOrder: true,
        isActive: true,
        isFeatured: true,
        category: { select: { slug: true } },
        station: { select: { code: true } },
        taxGroup: { select: { name: true } },
        variants: { where: { isDefault: true }, select: { price: true }, take: 1 },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      category_slug: row.category.slug,
      type: row.type,
      price: cell(row.variants[0]?.price ?? null),
      description: cell(row.description),
      short_description: cell(row.shortDescription),
      station_code: cell(row.station?.code ?? null),
      tax_group: cell(row.taxGroup?.name ?? null),
      dietary: cell(row.dietary),
      allergens: cell(row.allergens),
      spice_level: cell(row.spiceLevel),
      calories: cell(row.calories),
      prep_time_minutes: row.prepTimeMinutes,
      image_url: cell(row.imageUrl),
      sort_order: row.sortOrder,
      is_active: cell(row.isActive),
      is_featured: cell(row.isFeatured),
    }));
  },

  async variants() {
    const rows = await prisma.productVariant.findMany({
      where: { product: { deletedAt: null } },
      select: {
        sku: true,
        name: true,
        price: true,
        compareAtPrice: true,
        barcode: true,
        servingSize: true,
        isDefault: true,
        isActive: true,
        sortOrder: true,
        product: { select: { slug: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { sortOrder: "asc" }],
    });

    return rows.map((row) => ({
      sku: row.sku,
      product_slug: row.product.slug,
      name: row.name,
      price: cell(row.price),
      compare_at_price: cell(row.compareAtPrice),
      barcode: cell(row.barcode),
      serving_size: cell(row.servingSize),
      is_default: cell(row.isDefault),
      is_active: cell(row.isActive),
      sort_order: row.sortOrder,
    }));
  },

  async ["menu-items"]({ branchId = null, menuId = null } = {}) {
    const rows = await prisma.menuItem.findMany({
      where: {
        ...(menuId ? { menuId } : {}),
        ...(branchId ? { menu: { branchId } } : {}),
      },
      select: {
        priceOverride: true,
        isRecommended: true,
        sortOrder: true,
        menu: { select: { slug: true, branch: { select: { code: true } } } },
        section: { select: { name: true } },
        product: { select: { slug: true } },
        variant: { select: { sku: true } },
      },
      orderBy: [{ menuId: "asc" }, { sortOrder: "asc" }],
    });

    return rows.map((row) => ({
      branch_code: row.menu.branch.code,
      menu_slug: row.menu.slug,
      product_slug: row.product.slug,
      variant_sku: cell(row.variant?.sku ?? null),
      section_name: cell(row.section?.name ?? null),
      price_override: cell(row.priceOverride),
      is_recommended: cell(row.isRecommended),
      sort_order: row.sortOrder,
    }));
  },
};

export async function exportResource(resource, options = {}) {
  const exporter = EXPORTERS[resource];
  if (!exporter) throw ApiError.validation(`Unknown resource "${resource}"`);

  const rows = await exporter(options);

  return {
    resource,
    rowCount: rows.length,
    filename: `${resource}-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(columnNames(resource), rows),
  };
}

// --- import -----------------------------------------------------------------

/**
 * A blank cell leaves a field alone; `--` clears it. So an update is built from
 * only the columns the file actually spoke about.
 */
function assign(target, field, values, column, transform = (value) => value) {
  if (!(column in values)) return;
  target[field] = values[column] === null ? null : transform(values[column]);
}

const decimal = (value) => new Prisma.Decimal(value);

/** A SKU for a variant the file did not name, unique against the whole table. */
async function skuFor({ tx, productSlug, variantName }) {
  const base =
    `${slugify(productSlug)}-${slugify(variantName)}`.replace(/-+/g, "-").slice(0, 48).toUpperCase() || "SKU";

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await tx.productVariant.findUnique({ where: { sku: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }

  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

const IMPORTERS = {
  /**
   * Categories are ordered by depth before writing, so a file that lists a
   * child above its parent still imports. Sorting the rows is enough because
   * the tree is at most four levels deep and both rows are in the same file.
   */
  async categories({ tx, rows }) {
    const existing = new Map(
      (await tx.category.findMany({ select: { id: true, slug: true } })).map((row) => [row.slug, row.id]),
    );

    const bySlug = new Map(rows.map((row) => [row.values.slug, row]));
    const depth = (row, seen = new Set()) => {
      const parent = row.values.parent_slug;
      if (!parent || seen.has(row.values.slug)) return 0;
      seen.add(row.values.slug);
      const parentRow = bySlug.get(parent);
      return parentRow ? 1 + depth(parentRow, seen) : 0;
    };

    const ordered = [...rows].sort((a, b) => depth(a) - depth(b));
    let created = 0;
    let updated = 0;

    for (const row of ordered) {
      const { values } = row;
      const data = {};
      assign(data, "name", values, "name");
      assign(data, "description", values, "description");
      assign(data, "imageUrl", values, "image_url");
      assign(data, "sortOrder", values, "sort_order");
      assign(data, "isActive", values, "is_active");

      if ("parent_slug" in values) {
        const parentSlug = values.parent_slug;
        data.parentId = parentSlug === null ? null : (existing.get(parentSlug) ?? null);
        if (parentSlug !== null && !data.parentId) {
          throw ApiError.validation(`Line ${row.line}: parent category "${parentSlug}" does not exist`);
        }
      }

      const id = existing.get(values.slug);
      if (id) {
        await tx.category.update({ where: { id }, data });
        updated += 1;
      } else {
        const record = await tx.category.create({
          data: { slug: values.slug, name: values.name, ...data },
          select: { id: true },
        });
        existing.set(values.slug, record.id);
        created += 1;
      }
    }

    return { created, updated };
  },

  async products({ tx, rows }) {
    const [categories, stations, taxGroups] = await Promise.all([
      tx.category.findMany({ select: { id: true, slug: true } }),
      tx.kitchenStation.findMany({ select: { id: true, code: true } }),
      tx.taxGroup.findMany({ select: { id: true, name: true } }),
    ]);

    const categoryBySlug = new Map(categories.map((row) => [row.slug, row.id]));
    const stationByCode = new Map(stations.map((row) => [row.code.toUpperCase(), row.id]));
    const taxGroupByName = new Map(taxGroups.map((row) => [row.name.toLowerCase(), row.id]));

    const existing = new Map(
      (
        await tx.product.findMany({
          where: { slug: { in: rows.map((row) => row.values.slug) } },
          select: { id: true, slug: true, deletedAt: true },
        })
      ).map((row) => [row.slug, row]),
    );

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const { values } = row;

      const categoryId = categoryBySlug.get(values.category_slug);
      if (!categoryId) {
        throw ApiError.validation(`Line ${row.line}: category "${values.category_slug}" does not exist`);
      }

      const data = { categoryId };
      assign(data, "name", values, "name");
      assign(data, "description", values, "description");
      assign(data, "shortDescription", values, "short_description");
      assign(data, "type", values, "type");
      assign(data, "dietary", values, "dietary", (value) => value ?? []);
      assign(data, "allergens", values, "allergens", (value) => value ?? []);
      assign(data, "spiceLevel", values, "spice_level");
      assign(data, "calories", values, "calories");
      assign(data, "prepTimeMinutes", values, "prep_time_minutes");
      assign(data, "imageUrl", values, "image_url");
      assign(data, "sortOrder", values, "sort_order");
      assign(data, "isActive", values, "is_active");
      assign(data, "isFeatured", values, "is_featured");

      if ("station_code" in values) {
        const code = values.station_code;
        data.stationId = code === null ? null : stationByCode.get(code.toUpperCase());
        if (code !== null && !data.stationId) {
          throw ApiError.validation(`Line ${row.line}: kitchen station "${code}" does not exist`);
        }
      }

      if ("tax_group" in values) {
        const name = values.tax_group;
        data.taxGroupId = name === null ? null : taxGroupByName.get(name.toLowerCase());
        if (name !== null && !data.taxGroupId) {
          throw ApiError.validation(`Line ${row.line}: tax group "${name}" does not exist`);
        }
      }

      const found = existing.get(values.slug);

      if (found) {
        // A soft-deleted product still owns the slug. Silently reviving it
        // would be a surprising way to undo a deletion, so it is refused.
        if (found.deletedAt) {
          throw ApiError.conflict(
            `Line ${row.line}: "${values.slug}" was deleted. Restore it before importing against it.`,
          );
        }

        await tx.product.update({ where: { id: found.id }, data });
        if (values.price !== undefined) {
          await setDefaultPrice({ tx, productId: found.id, price: values.price, line: row.line });
        }
        updated += 1;
        continue;
      }

      const product = await tx.product.create({
        data: {
          slug: values.slug,
          name: values.name,
          categoryId,
          ...data,
          // Imported products are draft-by-default, exactly like `createProduct`
          // — nothing reaches a menu because a spreadsheet mentioned it.
          isActive: values.is_active ?? false,
        },
        select: { id: true, slug: true },
      });

      // Every product needs its one default variant, or it cannot be priced,
      // put on a menu, costed or stocked.
      await tx.productVariant.create({
        data: {
          productId: product.id,
          name: "Regular",
          sku: await skuFor({ tx, productSlug: product.slug, variantName: "Regular" }),
          price: decimal(values.price ?? "0"),
          isDefault: true,
        },
      });

      created += 1;
    }

    return { created, updated };
  },

  async variants({ tx, rows }) {
    const products = await tx.product.findMany({
      where: { slug: { in: [...new Set(rows.map((row) => row.values.product_slug))] }, deletedAt: null },
      select: { id: true, slug: true },
    });
    const productBySlug = new Map(products.map((row) => [row.slug, row.id]));

    const existing = new Map(
      (
        await tx.productVariant.findMany({
          where: { sku: { in: rows.map((row) => row.values.sku) } },
          select: { id: true, sku: true, productId: true },
        })
      ).map((row) => [row.sku, row]),
    );

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const { values } = row;

      const productId = productBySlug.get(values.product_slug);
      if (!productId) {
        throw ApiError.validation(`Line ${row.line}: product "${values.product_slug}" does not exist`);
      }

      const data = {};
      assign(data, "name", values, "name");
      assign(data, "price", values, "price", decimal);
      assign(data, "compareAtPrice", values, "compare_at_price", decimal);
      assign(data, "barcode", values, "barcode");
      assign(data, "servingSize", values, "serving_size");
      assign(data, "isActive", values, "is_active");
      assign(data, "sortOrder", values, "sort_order");

      const found = existing.get(values.sku);

      if (found) {
        // Moving a variant between products would orphan its recipe, its stock
        // history and every order line that snapshotted it.
        if (found.productId !== productId) {
          throw ApiError.conflict(`Line ${row.line}: SKU "${values.sku}" already belongs to another product`);
        }
        await tx.productVariant.update({ where: { id: found.id }, data });
        updated += 1;
      } else {
        const record = await tx.productVariant.create({
          data: { productId, sku: values.sku, name: values.name, price: decimal(values.price), ...data },
          select: { id: true, sku: true, productId: true },
        });
        existing.set(values.sku, record);
        created += 1;
      }

      // Exactly one default per product, so this is applied after the write and
      // clears the others rather than being set inline.
      if (values.is_default === true) {
        await tx.productVariant.updateMany({
          where: { productId, sku: { not: values.sku } },
          data: { isDefault: false },
        });
        await tx.productVariant.update({ where: { sku: values.sku }, data: { isDefault: true } });
      }
    }

    return { created, updated };
  },

  async ["menu-items"]({ tx, rows }) {
    const branches = await tx.branch.findMany({
      where: { code: { in: [...new Set(rows.map((row) => row.values.branch_code))] } },
      select: { id: true, code: true },
    });
    const branchByCode = new Map(branches.map((row) => [row.code, row.id]));

    const menus = await tx.menu.findMany({
      where: { branchId: { in: [...branchByCode.values()] } },
      select: { id: true, slug: true, branchId: true },
    });
    const menuByKey = new Map(menus.map((row) => [`${row.branchId} ${row.slug}`, row.id]));

    const products = await tx.product.findMany({
      where: { slug: { in: [...new Set(rows.map((row) => row.values.product_slug))] }, deletedAt: null },
      select: { id: true, slug: true, variants: { select: { id: true, sku: true, isDefault: true } } },
    });
    const productBySlug = new Map(products.map((row) => [row.slug, row]));

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const { values } = row;

      const branchId = branchByCode.get(values.branch_code);
      if (!branchId) throw ApiError.validation(`Line ${row.line}: branch "${values.branch_code}" does not exist`);

      const menuId = menuByKey.get(`${branchId} ${values.menu_slug}`);
      if (!menuId) {
        throw ApiError.validation(
          `Line ${row.line}: menu "${values.menu_slug}" does not exist at branch ${values.branch_code}`,
        );
      }

      const product = productBySlug.get(values.product_slug);
      if (!product) throw ApiError.validation(`Line ${row.line}: product "${values.product_slug}" does not exist`);

      // A menu item is always a (product, variant) pair — never a bare product.
      // See the note in menu.service.js: a NULL variant defeats the unique
      // constraint that is supposed to stop duplicates.
      const variant = values.variant_sku
        ? product.variants.find((entry) => entry.sku === values.variant_sku)
        : (product.variants.find((entry) => entry.isDefault) ?? product.variants[0]);

      if (!variant) {
        throw ApiError.validation(
          `Line ${row.line}: ${values.variant_sku ? `variant "${values.variant_sku}"` : "a default variant"} does not exist for "${values.product_slug}"`,
        );
      }

      let sectionId;
      if ("section_name" in values) {
        if (values.section_name === null) {
          sectionId = null;
        } else {
          const section =
            (await tx.menuSection.findFirst({
              where: { menuId, name: values.section_name },
              select: { id: true },
            })) ??
            (await tx.menuSection.create({
              data: { menuId, name: values.section_name },
              select: { id: true },
            }));
          sectionId = section.id;
        }
      }

      const data = {};
      if (sectionId !== undefined) data.sectionId = sectionId;
      assign(data, "priceOverride", values, "price_override", decimal);
      assign(data, "isRecommended", values, "is_recommended");
      assign(data, "sortOrder", values, "sort_order");

      const found = await tx.menuItem.findFirst({
        where: { menuId, productId: product.id, variantId: variant.id },
        select: { id: true },
      });

      if (found) {
        await tx.menuItem.update({ where: { id: found.id }, data });
        updated += 1;
      } else {
        await tx.menuItem.create({ data: { menuId, productId: product.id, variantId: variant.id, ...data } });
        created += 1;
      }
    }

    return { created, updated };
  },
};

/** Writes the `price` shorthand onto whichever variant is the product's default. */
async function setDefaultPrice({ tx, productId, price, line }) {
  const variant =
    (await tx.productVariant.findFirst({ where: { productId, isDefault: true }, select: { id: true } })) ??
    (await tx.productVariant.findFirst({ where: { productId }, select: { id: true }, orderBy: { sortOrder: "asc" } }));

  if (!variant) throw ApiError.validation(`Line ${line}: product has no variant to price`);

  await tx.productVariant.update({ where: { id: variant.id }, data: { price: decimal(price) } });
}

/**
 * Validates a whole file, then applies it in one transaction.
 *
 * Validation is complete before any write: the caller gets every bad row at
 * once, which is the difference between one round of corrections and fifty.
 */
export async function importResource({ resource, csv, dryRun = false }) {
  if (!RESOURCES[resource]) {
    throw ApiError.validation(`Unknown resource "${resource}"`, {
      resource: [`Expected one of ${Object.keys(RESOURCES).join(", ")}`],
    });
  }

  const { headers, records } = parseCsvRecords(csv);
  if (!records.length) throw ApiError.validation("The file has a header but no rows");
  if (records.length > MAX_ROWS) {
    throw ApiError.validation(`That file has ${records.length} rows; the limit is ${MAX_ROWS}. Split it.`);
  }

  const header = validateHeaders(resource, headers);
  if (header.errors.length) {
    throw ApiError.validation("That file's columns do not match the format", { columns: header.errors });
  }

  const rows = [];
  const rowErrors = [];
  const seen = new Map();

  for (const record of records) {
    const { values, errors } = coerceRow(resource, record.values);

    if (errors.length) {
      rowErrors.push({ line: record.line, errors });
      continue;
    }

    // Two rows for the same key would apply in file order and silently discard
    // the first, which reads as "my edit did not save".
    const key = keyOf(resource, values);
    const first = seen.get(key);
    if (first) {
      rowErrors.push({ line: record.line, errors: [`Duplicate of line ${first} ("${key}")`] });
      continue;
    }

    seen.set(key, record.line);
    rows.push({ line: record.line, values });
  }

  const report = {
    resource,
    dryRun,
    rowsRead: records.length,
    rowsValid: rows.length,
    unknownColumns: header.unknown,
    errors: rowErrors,
  };

  if (rowErrors.length) {
    return { ...report, applied: false, created: 0, updated: 0 };
  }

  if (dryRun) {
    return { ...report, applied: false, created: 0, updated: 0 };
  }

  const result = await withTransaction(
    async (tx) => IMPORTERS[resource]({ tx, rows }),
    // A few thousand rows of writes will not finish inside the default window.
    { timeout: 120_000, maxWait: 15_000 },
  );

  return { ...report, applied: true, ...result };
}

export function importFormat() {
  return {
    resources: Object.entries(RESOURCES).map(([name, spec]) => ({
      resource: name,
      label: spec.label,
      key: spec.key,
      columns: spec.columns.map((column) => ({
        name: column.name,
        required: Boolean(column.required),
        clearable: Boolean(column.clearable),
      })),
    })),
    notes: [
      "A blank cell leaves the existing value alone. Use -- to clear a field.",
      "Lists (dietary, allergens) are pipe-separated: VEG|HALAL.",
      "Rows are matched on the natural key, so re-importing an export updates rather than duplicates.",
      "Nothing is ever deleted by an import; a missing row means 'not mentioned'.",
      `At most ${MAX_ROWS} rows per file.`,
    ],
  };
}
