import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { generateUniqueSlug } from "@/server/utils/slug";
import { slugify } from "@/lib/slug";
import { withTransaction } from "@/server/utils/db";
import { assertProductReach, productScopeWhere } from "@/server/catalog/access";

/**
 * Products and their variants.
 *
 * The single rule the rest of the system leans on: **every product has at least
 * one active variant, and exactly one of them is the default**. A "Simple"
 * product is not a special case in the data — it is a product with one variant
 * called "Regular". That is why ordering, recipes, stock and menu pricing only
 * ever have to deal with variants, and never branch on product type. Creating a
 * simple product with a bare `price` is a convenience of this service, not of
 * the schema.
 *
 * Products are global; a branch decides what it sells by putting them on a menu
 * (see `menu.service.js`).
 */

const VARIANT_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  price: true,
  compareAtPrice: true,
  standardCost: true,
  servingSize: true,
  isDefault: true,
  isActive: true,
  sortOrder: true,
};

const LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  type: true,
  categoryId: true,
  imageUrl: true,
  dietary: true,
  spiceLevel: true,
  isActive: true,
  isFeatured: true,
  sortOrder: true,
  deletedAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true, isActive: true } },
  variants: {
    where: { isActive: true },
    select: VARIANT_SELECT,
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  },
};

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  allergens: true,
  calories: true,
  prepTimeMinutes: true,
  taxGroupId: true,
  stationId: true,
  createdAt: true,
  station: { select: { id: true, name: true, code: true } },
  images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
  variants: { select: VARIANT_SELECT, orderBy: [{ sortOrder: "asc" }, { price: "asc" }] },
  modifierGroups: {
    orderBy: { sortOrder: "asc" },
    select: {
      isRequired: true,
      minSelect: true,
      maxSelect: true,
      sortOrder: true,
      group: {
        select: {
          id: true,
          name: true,
          selectionType: true,
          minSelect: true,
          maxSelect: true,
          allowQuantity: true,
          isActive: true,
          options: {
            where: { isActive: true },
            select: { id: true, name: true, priceDelta: true, isDefault: true, sortOrder: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  },
  comboGroups: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      minSelect: true,
      maxSelect: true,
      sortOrder: true,
      options: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          quantity: true,
          priceDelta: true,
          isDefault: true,
          sortOrder: true,
          product: { select: { id: true, name: true, slug: true, imageUrl: true, isActive: true } },
          variant: { select: { id: true, name: true, price: true, isActive: true } },
        },
      },
    },
  },
};

/**
 * Flattens the join row so a client sees one modifier group with its effective
 * rules, rather than a group plus a set of overrides it has to merge itself.
 */
function shapeModifierGroups(rows = []) {
  return rows
    .filter((row) => row.group.isActive)
    .map((row) => ({
      id: row.group.id,
      name: row.group.name,
      selectionType: row.group.selectionType,
      allowQuantity: row.group.allowQuantity,
      isRequired: row.isRequired,
      minSelect: row.minSelect ?? row.group.minSelect,
      maxSelect: row.maxSelect ?? row.group.maxSelect,
      sortOrder: row.sortOrder,
      options: row.group.options,
    }));
}

export function shapeProduct(product) {
  if (!product) return product;
  const { modifierGroups, ...rest } = product;

  /*
   * A combo slot's options are products too, and when the caller asked for
   * their option groups they arrive in the same unflattened shape. Shaped here
   * rather than in the page, so the form that renders a product's groups can
   * render a combo choice's groups without knowing which it has.
   */
  const comboGroups = rest.comboGroups?.map((group) => ({
    ...group,
    options: group.options.map((option) =>
      option.product?.modifierGroups
        ? {
            ...option,
            product: { ...option.product, modifierGroups: shapeModifierGroups(option.product.modifierGroups) },
          }
        : option,
    ),
  }));

  return {
    ...rest,
    ...(comboGroups ? { comboGroups } : {}),
    ...(modifierGroups ? { modifierGroups: shapeModifierGroups(modifierGroups) } : {}),
    ...(rest.variants
      ? {
          defaultVariant: rest.variants.find((variant) => variant.isDefault) ?? rest.variants[0] ?? null,
          priceFrom: rest.variants.length ? Math.min(...rest.variants.map((v) => Number(v.price))) : null,
        }
      : {}),
  };
}

/**
 * A readable SKU derived from the names, uniquified against the whole table.
 *
 * SKUs are globally unique in the schema because they end up on barcodes and
 * purchase orders, where "which product was that" must have one answer.
 */
async function generateSku({ productSlug, variantName, client = prisma }) {
  const base =
    `${slugify(productSlug)}-${slugify(variantName)}`.replace(/-+/g, "-").slice(0, 48).toUpperCase() || "SKU";

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await client.productVariant.findUnique({ where: { sku: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }

  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/** Normalises a set of variant inputs: unique names, exactly one default. */
function assertVariantSetIsSane(variants) {
  const names = variants.map((variant) => variant.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw ApiError.validation("Variant names must be unique within a product", {
      variants: ["Two variants share the same name"],
    });
  }

  const defaults = variants.filter((variant) => variant.isDefault);
  if (defaults.length > 1) {
    throw ApiError.validation("Only one variant can be the default", { variants: ["Mark a single default variant"] });
  }
}

async function assertReferencesExist({ categoryId, stationId, taxGroupId }) {
  if (categoryId) {
    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw ApiError.validation("Category not found", { categoryId: ["No such category"] });
  }
  if (stationId) {
    const station = await prisma.kitchenStation.findUnique({ where: { id: stationId }, select: { id: true } });
    if (!station) throw ApiError.validation("Kitchen station not found", { stationId: ["No such station"] });
  }
  if (taxGroupId) {
    const group = await prisma.taxGroup.findUnique({ where: { id: taxGroupId }, select: { id: true } });
    if (!group) throw ApiError.validation("Tax group not found", { taxGroupId: ["No such tax group"] });
  }
}

// --- reads ------------------------------------------------------------------

export async function listProducts({
  search,
  categoryId,
  stationId,
  type,
  isActive,
  isFeatured,
  branchId,
  scope = null,
  includeDeleted = false,
  onlyDeleted = false,
  limit = 20,
  cursor,
} = {}) {
  const rows = await prisma.product.findMany({
    where: {
      // The caller's scope first; a requested branch can only narrow it.
      ...productScopeWhere(scope),
      ...(branchId ? { branchId } : {}),
      ...(onlyDeleted ? { deletedAt: { not: null } } : includeDeleted ? {} : { deletedAt: null }),
      ...(categoryId ? { categoryId } : {}),
      ...(stationId ? { stationId } : {}),
      ...(type ? { type } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(isFeatured !== undefined ? { isFeatured } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { shortDescription: { contains: search, mode: "insensitive" } },
              { variants: { some: { sku: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    select: LIST_SELECT,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(shapeProduct) };
}

export async function getProduct(idOrSlug, { includeDeleted = false, scope = null } = {}) {
  const product = await prisma.product.findFirst({
    where: {
      AND: [
        productScopeWhere(scope),
        { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      ],
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    select: DETAIL_SELECT,
  });
  // 404 rather than 403 for another branch's product: a 403 confirms the id
  // is real. Out of scope and non-existent are the same answer here.
  if (!product) throw ApiError.notFound("Product not found");

  return shapeProduct(product);
}

/**
 * The menus each product is on, keyed by product id.
 *
 * Publishing a product does not put it on sale: ordering always resolves
 * against a branch's menu, so a published product on no menu is visible in the
 * catalog and cannot be bought. That is the most likely "why isn't it selling?"
 * question an operator will have, so the admin screens show placement next to
 * the publish state rather than leaving it to be discovered.
 *
 * A menu lists a product once per variant; this counts menus, not rows.
 */
export async function menuPlacements(productIds) {
  const placements = new Map(productIds.map((id) => [id, []]));
  if (!productIds.length) return placements;

  const rows = await prisma.menuItem.findMany({
    where: { productId: { in: productIds } },
    distinct: ["productId", "menuId"],
    select: {
      productId: true,
      menu: {
        select: { id: true, name: true, type: true, isActive: true, branch: { select: { id: true, name: true } } },
      },
    },
  });

  for (const row of rows) placements.get(row.productId)?.push(row.menu);
  return placements;
}

// --- writes -----------------------------------------------------------------

export async function createProduct(data, actor) {
  const { price, variants: variantInput, images, ...productData } = data;

  // A product with no branch is on every outlet's catalogue, so writing one
  // takes a company-wide grant — the same test a chain-wide promotion gets.
  assertProductReach(actor, productData.branchId ?? null, "products.create");

  await assertReferencesExist(productData);

  // A combo is priced by its own base variant plus each option's delta, so it
  // still gets a variant — the price just defaults to 0 when not supplied.
  const variants =
    variantInput?.length > 0
      ? variantInput
      : [{ name: "Regular", price: price ?? 0, isDefault: true, sortOrder: 0 }];

  assertVariantSetIsSane(variants);

  if (variants.length > 1 && productData.type === "SIMPLE") productData.type = "VARIANT";

  const slug = await generateUniqueSlug({ text: productData.slug ?? productData.name, model: "product" });

  // SKUs are resolved before the transaction: each lookup is a round trip, and
  // holding a transaction open across them for a 20-variant product would pin a
  // connection for no benefit. The unique index is the real guarantee.
  const prepared = [];
  for (const [index, variant] of variants.entries()) {
    prepared.push({
      ...variant,
      sku: variant.sku ?? (await generateSku({ productSlug: slug, variantName: variant.name })),
      isDefault: variants.length === 1 ? true : Boolean(variant.isDefault),
      sortOrder: variant.sortOrder ?? index,
    });
  }
  // Nothing was marked default in a multi-variant set: the first one wins.
  if (!prepared.some((variant) => variant.isDefault)) prepared[0].isDefault = true;

  const product = await prisma.product.create({
    data: {
      ...productData,
      slug,
      // Always created as a draft. Publishing is a separate permission, so
      // letting the create payload set `isActive` would let anyone holding
      // `products.create` put an unreviewed item in front of customers
      // without ever holding `products.publish`.
      isActive: false,
      createdById: actor?.userId ?? null,
      variants: { create: prepared },
      ...(images?.length
        ? { images: { create: images.map((image, index) => ({ ...image, sortOrder: image.sortOrder ?? index })) } }
        : {}),
    },
    select: { id: true },
  });

  return getProduct(product.id);
}

export async function updateProduct(id, data, actor = null) {
  const existing = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, branchId: true },
  });
  if (!existing) throw ApiError.notFound("Product not found");

  // Both sides of the edit, as with commission rules: the product as it
  // stands, and the product it would become. Checking only the new owner
  // would let a branch manager promote their own item to the whole chain;
  // checking only the old one would let them capture somebody else's.
  if (actor) {
    assertProductReach(actor, existing.branchId, "products.update");
    if ("branchId" in data) assertProductReach(actor, data.branchId ?? null, "products.update");
  }

  await assertReferencesExist(data);

  const slug = data.slug ? await generateUniqueSlug({ text: data.slug, model: "product", excludeId: id }) : undefined;

  await prisma.product.update({ where: { id }, data: { ...data, ...(slug ? { slug } : {}) } });
  return getProduct(id);
}

/**
 * Publishing is separate from editing on purpose: `products.publish` is its own
 * permission, so a menu writer can draft an item that only a manager can put in
 * front of customers.
 */
export async function setProductPublished(id, isActive) {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, variants: { where: { isActive: true }, select: { id: true } } },
  });
  if (!product) throw ApiError.notFound("Product not found");

  if (isActive && product.variants.length === 0) {
    throw ApiError.conflict("A product needs at least one active variant before it can be published");
  }

  await prisma.product.update({ where: { id }, data: { isActive } });
  return getProduct(id);
}

/**
 * Soft delete.
 *
 * Order history references products by id; a hard delete would cascade through
 * `ProductVariant` and take order lines' pricing context with it. Every read
 * path filters `deletedAt: null`, and the product also leaves every menu so it
 * cannot be ordered while the row survives for reporting.
 */
export async function deleteProduct(id) {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!product) throw ApiError.notFound("Product not found");

  const result = await withTransaction(async (tx) => {
    const removedFromMenus = await tx.menuItem.deleteMany({ where: { productId: id } });
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return removedFromMenus.count;
  });

  return { deleted: true, id, removedFromMenus: result };
}

export async function restoreProduct(id) {
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!product) throw ApiError.notFound("Product not found");
  if (!product.deletedAt) throw ApiError.conflict("This product is not deleted");

  // Restored unpublished: it left every menu on delete, so someone has to look
  // at it before customers can see it again.
  await prisma.product.update({ where: { id }, data: { deletedAt: null, isActive: false } });
  return getProduct(id);
}

// --- images -----------------------------------------------------------------

/** Replace-all, because the gallery editor sends the whole ordered list. */
export async function setProductImages(id, images) {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!product) throw ApiError.notFound("Product not found");

  await withTransaction(async (tx) => {
    await tx.productImage.deleteMany({ where: { productId: id } });
    if (images.length) {
      await tx.productImage.createMany({
        data: images.map((image, index) => ({ ...image, productId: id, sortOrder: image.sortOrder ?? index })),
      });
    }
  });

  return prisma.productImage.findMany({
    where: { productId: id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, url: true, altText: true, sortOrder: true },
  });
}

// --- variants ---------------------------------------------------------------

/**
 * SKUs are unique across the whole catalogue, not just within a product. The
 * database enforces it, but its refusal reads "That record already exists" —
 * which does not say *what* exists or where. Checked first so the message names
 * the SKU and the product already using it.
 */
async function assertSkuIsFree(sku, { exceptVariantId = null } = {}) {
  if (!sku) return;
  const clash = await prisma.productVariant.findFirst({
    where: { sku: sku.trim(), ...(exceptVariantId ? { id: { not: exceptVariantId } } : {}) },
    select: { name: true, product: { select: { name: true } } },
  });
  if (clash) {
    throw ApiError.conflict(`The SKU "${sku.trim()}" is already used by ${clash.product.name} (${clash.name})`);
  }
}

export async function listVariants(productId) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
  if (!product) throw ApiError.notFound("Product not found");

  return prisma.productVariant.findMany({
    where: { productId },
    select: VARIANT_SELECT,
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
}

export async function addVariant(productId, data) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, slug: true, type: true, variants: { select: { id: true, name: true } } },
  });
  if (!product) throw ApiError.notFound("Product not found");

  const clash = product.variants.some((variant) => variant.name.toLowerCase() === data.name.trim().toLowerCase());
  if (clash) throw ApiError.conflict(`This product already has a variant called "${data.name}"`);

  await assertSkuIsFree(data.sku);
  const sku = data.sku ?? (await generateSku({ productSlug: product.slug, variantName: data.name }));

  const variant = await withTransaction(async (tx) => {
    if (data.isDefault) {
      await tx.productVariant.updateMany({ where: { productId }, data: { isDefault: false } });
    }
    // Adding a second size makes a SIMPLE product a VARIANT one; keeping the
    // type honest matters because the storefront renders a size picker off it.
    if (product.type === "SIMPLE" && product.variants.length >= 1) {
      await tx.product.update({ where: { id: productId }, data: { type: "VARIANT" } });
    }

    return tx.productVariant.create({
      data: { ...data, sku, productId, sortOrder: data.sortOrder ?? product.variants.length },
      select: VARIANT_SELECT,
    });
  });

  return variant;
}

export async function updateVariant({ productId, variantId, data }) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId, product: { deletedAt: null } },
    select: { id: true, isDefault: true, isActive: true },
  });
  if (!variant) throw ApiError.notFound("Variant not found");

  if (data.name) {
    const clash = await prisma.productVariant.findFirst({
      where: { productId, id: { not: variantId }, name: { equals: data.name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`This product already has a variant called "${data.name}"`);
  }

  await assertSkuIsFree(data.sku, { exceptVariantId: variantId });

  // Never leave a product with no sellable variant, and never leave the default
  // pointing at a deactivated one.
  if (data.isActive === false) {
    const otherActive = await prisma.productVariant.count({
      where: { productId, id: { not: variantId }, isActive: true },
    });
    if (otherActive === 0) {
      throw ApiError.conflict("A product must keep at least one active variant. Unpublish the product instead.");
    }
  }
  if (data.isDefault === false && variant.isDefault) {
    throw ApiError.validation("Make another variant the default rather than clearing this one", {
      isDefault: ["Set isDefault on the variant that should take over"],
    });
  }

  return withTransaction(async (tx) => {
    if (data.isDefault) {
      await tx.productVariant.updateMany({ where: { productId }, data: { isDefault: false } });
    }

    const updated = await tx.productVariant.update({ where: { id: variantId }, data, select: VARIANT_SELECT });

    if (data.isActive === false && variant.isDefault) {
      const replacement = await tx.productVariant.findFirst({
        where: { productId, isActive: true },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true },
      });
      if (replacement) {
        await tx.productVariant.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }

    return updated;
  });
}

export async function deleteVariant({ productId, variantId }) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: { id: true, isDefault: true, _count: { select: { orderItems: true } } },
  });
  if (!variant) throw ApiError.notFound("Variant not found");

  const siblings = await prisma.productVariant.count({ where: { productId, id: { not: variantId } } });
  if (siblings === 0) throw ApiError.conflict("A product must keep at least one variant. Delete the product instead.");

  // Sold at least once: the order line's price context lives here.
  if (variant._count.orderItems > 0) {
    throw ApiError.conflict("This variant has been ordered. Deactivate it instead of deleting it.");
  }

  await withTransaction(async (tx) => {
    await tx.menuItem.deleteMany({ where: { variantId } });
    await tx.productVariant.delete({ where: { id: variantId } });

    if (variant.isDefault) {
      const replacement = await tx.productVariant.findFirst({
        where: { productId, isActive: true },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true },
      });
      if (replacement) await tx.productVariant.update({ where: { id: replacement.id }, data: { isDefault: true } });
    }
  });

  return { deleted: true, id: variantId };
}
