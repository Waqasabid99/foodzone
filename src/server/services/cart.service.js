import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { getSettings } from "@/server/services/setting.service";
import { getBranchMenu, isItemAvailable } from "@/server/services/menu.service";
import { priceOrder } from "@/server/pricing/engine";
import { resolveOrderDiscounts } from "@/server/services/promotion.service";
import { validateCoupon } from "@/server/services/coupon.service";
import { logger } from "@/lib/logger";

/**
 * The server-side cart.
 *
 * One basket shared by the website and the app, which is only possible because
 * it lives here rather than in either client's local storage. A guest's cart
 * keys off an anonymous `sessionId` and is claimed by their account at login,
 * so nothing is lost between browsing and signing in.
 *
 * **The cart stores intent, not prices.** A row records "one large pizza with
 * extra cheese"; what that costs is resolved from the branch's live menu on
 * every read. That is what makes a menu price change, a variant going inactive
 * or an item being 86'd show up in an open cart immediately, and it is why no
 * client can influence what it is charged.
 *
 * Carts expire (default 7 days), which is also what the creator-attribution
 * window hangs off later.
 */

const CART_TTL_DAYS = 7;

const ITEM_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  quantity: true,
  notes: true,
  modifiers: true,
  comboSelections: true,
  createdAt: true,
};

const CART_SELECT = {
  id: true,
  userId: true,
  sessionId: true,
  branchId: true,
  type: true,
  couponCode: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  items: { select: ITEM_SELECT, orderBy: { createdAt: "asc" } },
};

function expiryFrom(now = new Date()) {
  return new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Finds the caller's cart, creating one if needed.
 *
 * A signed-in caller is matched by `userId`; a guest by `sessionId`. Both may be
 * present during checkout, right after a login — `claimGuestCart` is what
 * merges them, and it runs before this.
 */
export async function resolveCart({ userId = null, sessionId = null, create = true }) {
  if (!userId && !sessionId) {
    throw ApiError.validation("A cart needs a signed-in user or a session id", {
      sessionId: ["Send x-session-id, or sign in"],
    });
  }

  const existing = userId
    ? await prisma.cart.findFirst({ where: { userId }, select: CART_SELECT, orderBy: { updatedAt: "desc" } })
    : await prisma.cart.findUnique({ where: { sessionId }, select: CART_SELECT });

  if (existing) return existing;
  if (!create) return null;

  return prisma.cart.create({
    data: { userId, sessionId: userId ? null : sessionId, expiresAt: expiryFrom() },
    select: CART_SELECT,
  });
}

/**
 * Merges a guest's cart into their account at login.
 *
 * Items are moved rather than replaced: someone who filled a basket, then
 * signed in to check out, must not find it emptied by an older cart from
 * another device. Where both carts hold the same line the quantities add, which
 * is what "I put two in earlier and two now" means.
 */
export async function claimGuestCart({ userId, sessionId }) {
  if (!sessionId) return null;

  return withTransaction(async (tx) => {
    const guest = await tx.cart.findUnique({ where: { sessionId }, select: CART_SELECT });
    if (!guest) return null;

    // Already this user's cart: nothing to merge.
    if (guest.userId === userId) return guest;

    const owned = await tx.cart.findFirst({
      where: { userId },
      select: CART_SELECT,
      orderBy: { updatedAt: "desc" },
    });

    if (!owned) {
      // No account cart yet — adopt the guest cart wholesale. Any creator
      // attributions come with it and simply learn who the viewer was.
      await tx.cart.update({
        where: { id: guest.id },
        data: { userId, sessionId: null, expiresAt: expiryFrom() },
      });
      await tx.creatorAttribution.updateMany({
        where: { cartId: guest.id, viewerId: null },
        data: { viewerId: userId },
      });
      return tx.cart.findUnique({ where: { id: guest.id }, select: CART_SELECT });
    }

    for (const item of guest.items) {
      const match = owned.items.find((row) => sameLine(row, item));
      if (match) {
        await tx.cartItem.update({
          where: { id: match.id },
          data: { quantity: Math.min(match.quantity + item.quantity, 99) },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: owned.id,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            notes: item.notes,
            modifiers: item.modifiers ?? undefined,
            comboSelections: item.comboSelections ?? undefined,
          },
        });
      }
    }

    // Creator attributions move across before the guest cart is deleted. They
    // cascade with the cart, so a guest who added from a video and only signed
    // in at checkout would otherwise lose the creator their claim on the sale —
    // silently, and precisely in the flow the program depends on most.
    const guestAttributions = await tx.creatorAttribution.findMany({
      where: { cartId: guest.id, status: "ACTIVE" },
      select: { id: true, productId: true, videoId: true, creatorId: true, variantId: true, surface: true, shareLinkId: true, attributedAt: true, expiresAt: true, touchCount: true },
    });

    for (const attribution of guestAttributions) {
      const clash = await tx.creatorAttribution.findUnique({
        where: { cartId_productId: { cartId: owned.id, productId: attribution.productId } },
        select: { id: true, attributedAt: true },
      });

      // Last touch still wins across the merge: whichever video put the product
      // in a basket most recently is the one that sold it.
      if (clash && new Date(clash.attributedAt) >= new Date(attribution.attributedAt)) continue;

      if (clash) await tx.creatorAttribution.delete({ where: { id: clash.id } });

      await tx.creatorAttribution.update({
        where: { id: attribution.id },
        data: { cartId: owned.id, viewerId: userId },
      });
    }

    // The guest cart is consumed, not left behind to be claimed twice.
    await tx.cart.delete({ where: { id: guest.id } });

    // The branch, order type and coupon come across with the items.
    //
    // Without this the merge moves *what* they were buying but not *where*, and
    // the account's own cart — which is usually an empty one created the moment
    // anything read `/cart` while signed in — has no branch at all. The customer
    // then lands on a basket whose every line reads "unavailable", because a
    // line can only be priced against a branch's menu. They filled that basket
    // seconds earlier, so the guest cart is the session they are actually
    // using, and its context is the one that should survive.
    await tx.cart.update({
      where: { id: owned.id },
      data: {
        expiresAt: expiryFrom(),
        ...(guest.branchId ? { branchId: guest.branchId, type: guest.type } : {}),
        ...(guest.couponCode ? { couponCode: guest.couponCode } : {}),
      },
    });

    return tx.cart.findUnique({ where: { id: owned.id }, select: CART_SELECT });
  });
}

/** Two lines are the same when the product, variant and every choice match. */
function sameLine(a, b) {
  if (a.productId !== b.productId || (a.variantId ?? null) !== (b.variantId ?? null)) return false;
  if ((a.notes ?? "") !== (b.notes ?? "")) return false;
  return signature(a.modifiers) === signature(b.modifiers) && signature(a.comboSelections) === signature(b.comboSelections);
}

/** Order-independent fingerprint of a selection list. */
function signature(value) {
  if (!Array.isArray(value) || !value.length) return "";
  return value
    .map((entry) => JSON.stringify(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))))
    .sort()
    .join("|");
}

// --- validation -------------------------------------------------------------

/**
 * Resolves a requested line against the branch's live menu.
 *
 * Everything a client sends is treated as a claim to be checked: that the
 * product is on this branch's menu at all, that the variant belongs to it, that
 * each modifier belongs to a group actually attached to the product, and that
 * the group's own min/max rules are satisfied. Skipping any of these lets a
 * crafted request order something that is not for sale, or price a burger with
 * another product's discount-priced modifier.
 */
async function resolveLine({ productId, variantId, quantity, modifiers = [], comboSelections = [], menuIndex }) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      // Carried so the cart can show a thumbnail and link back to the item
      // without a second query per basket line.
      slug: true,
      imageUrl: true,
      type: true,
      // Carried onto the line so a category-targeted promotion can be resolved
      // without a second lookup per basket line.
      categoryId: true,
      stationId: true,
      taxGroupId: true,
      prepTimeMinutes: true,
      variants: {
        where: { isActive: true },
        select: { id: true, name: true, sku: true, price: true, standardCost: true, isDefault: true },
      },
      modifierGroups: {
        select: {
          isRequired: true,
          minSelect: true,
          maxSelect: true,
          group: {
            select: {
              id: true,
              name: true,
              selectionType: true,
              minSelect: true,
              maxSelect: true,
              allowQuantity: true,
              isActive: true,
              options: { where: { isActive: true }, select: { id: true, name: true, priceDelta: true } },
            },
          },
        },
      },
      comboGroups: {
        select: {
          id: true,
          name: true,
          minSelect: true,
          maxSelect: true,
          options: {
            select: {
              id: true,
              productId: true,
              variantId: true,
              quantity: true,
              priceDelta: true,
              product: { select: { id: true, name: true, isActive: true, deletedAt: true } },
              variant: { select: { id: true, name: true, sku: true, price: true, standardCost: true } },
            },
          },
        },
      },
    },
  });

  if (!product) throw ApiError.validation("That item is not available", { productId: ["No such product"] });

  const variant = variantId
    ? product.variants.find((row) => row.id === variantId)
    : (product.variants.find((row) => row.isDefault) ?? product.variants[0]);

  if (!variant) {
    throw ApiError.validation("That option is no longer available", { variantId: ["Pick an available option"] });
  }

  // The menu decides both the price and whether it may be sold here at all.
  const menuEntry = menuIndex.get(variant.id);
  if (!menuEntry) {
    throw ApiError.conflict(`"${product.name}" is not on the menu at this branch right now`, {
      productId,
      variantId: variant.id,
    });
  }
  if (!menuEntry.available) {
    throw ApiError.conflict(`"${product.name}" is sold out`, { productId, variantId: variant.id });
  }

  const resolvedModifiers = resolveModifiers({ product, modifiers });
  const resolvedCombo = product.type === "COMBO" ? resolveComboSelections({ product, comboSelections }) : [];

  return {
    productId: product.id,
    variantId: variant.id,
    name: product.name,
    slug: product.slug,
    imageUrl: product.imageUrl,
    sku: variant.sku,
    variantName: variant.name,
    categoryId: product.categoryId,
    stationId: product.stationId,
    taxGroupId: product.taxGroupId,
    prepTimeMinutes: product.prepTimeMinutes,
    unitPrice: menuEntry.price,
    unitCost: variant.standardCost,
    quantity,
    modifiers: resolvedModifiers,
    comboSelections: resolvedCombo,
    // Combo option surcharges ride on the parent line, matching the schema's
    // "the parent carries the combo price".
    comboSurcharge: resolvedCombo.reduce((total, choice) => total + Number(choice.priceDelta), 0),
  };
}

function resolveModifiers({ product, modifiers }) {
  const attached = product.modifierGroups.filter((row) => row.group.isActive);
  const byOptionId = new Map();
  for (const row of attached) {
    for (const option of row.group.options) byOptionId.set(option.id, { row, option });
  }

  const resolved = [];
  const countByGroup = new Map();

  for (const requested of modifiers) {
    const found = byOptionId.get(requested.optionId);
    if (!found) {
      throw ApiError.validation("That choice is not available for this item", {
        modifiers: [`Unknown option ${requested.optionId}`],
      });
    }

    const { row, option } = found;
    const quantity = requested.quantity ?? 1;

    if (quantity > 1 && !row.group.allowQuantity) {
      throw ApiError.validation(`"${row.group.name}" does not allow the same choice more than once`, {
        modifiers: [option.name],
      });
    }

    resolved.push({
      optionId: option.id,
      groupId: row.group.id,
      groupName: row.group.name,
      name: option.name,
      priceDelta: Number(option.priceDelta),
      quantity,
    });

    countByGroup.set(row.group.id, (countByGroup.get(row.group.id) ?? 0) + quantity);
  }

  // Rules are checked per group, including groups the client omitted entirely —
  // a required "choose your crust" must fail when nothing was sent, not pass
  // because there was nothing to validate.
  for (const row of attached) {
    const chosen = countByGroup.get(row.group.id) ?? 0;
    const min = row.minSelect ?? row.group.minSelect;
    const max = row.maxSelect ?? row.group.maxSelect;

    if (row.isRequired && chosen < Math.max(min, 1)) {
      throw ApiError.validation(`"${row.group.name}" is required`, {
        modifiers: [`Choose at least ${Math.max(min, 1)} from ${row.group.name}`],
      });
    }
    if (chosen > 0 && chosen < min) {
      throw ApiError.validation(`Choose at least ${min} from "${row.group.name}"`, { modifiers: [row.group.name] });
    }
    if (chosen > max) {
      throw ApiError.validation(`Choose at most ${max} from "${row.group.name}"`, { modifiers: [row.group.name] });
    }
  }

  return resolved;
}

function resolveComboSelections({ product, comboSelections }) {
  const resolved = [];
  const countByGroup = new Map();

  for (const requested of comboSelections) {
    const group = product.comboGroups.find((row) => row.id === requested.groupId);
    if (!group) {
      throw ApiError.validation("That combo choice does not belong to this item", {
        comboSelections: [`Unknown group ${requested.groupId}`],
      });
    }

    const option = group.options.find(
      (row) =>
        row.productId === requested.productId &&
        (requested.variantId ? row.variantId === requested.variantId : true),
    );
    if (!option) {
      throw ApiError.validation(`That is not one of the choices in "${group.name}"`, {
        comboSelections: [group.name],
      });
    }
    if (!option.product.isActive || option.product.deletedAt) {
      throw ApiError.conflict(`"${option.product.name}" is not available right now`);
    }

    const quantity = requested.quantity ?? option.quantity ?? 1;
    resolved.push({
      groupId: group.id,
      groupName: group.name,
      optionId: option.id,
      productId: option.productId,
      variantId: option.variantId,
      name: option.product.name,
      variantName: option.variant?.name ?? null,
      sku: option.variant?.sku ?? null,
      unitCost: option.variant?.standardCost ?? null,
      priceDelta: Number(option.priceDelta) * quantity,
      quantity,
    });

    countByGroup.set(group.id, (countByGroup.get(group.id) ?? 0) + quantity);
  }

  for (const group of product.comboGroups) {
    const chosen = countByGroup.get(group.id) ?? 0;
    if (chosen < group.minSelect) {
      throw ApiError.validation(`Choose at least ${group.minSelect} from "${group.name}"`, {
        comboSelections: [group.name],
      });
    }
    if (chosen > group.maxSelect) {
      throw ApiError.validation(`Choose at most ${group.maxSelect} from "${group.name}"`, {
        comboSelections: [group.name],
      });
    }
  }

  return resolved;
}

/**
 * Every variant the branch is currently selling, with its menu price.
 *
 * Built once per cart read rather than queried per line: a ten-line cart would
 * otherwise be ten menu resolutions, and the menu read is the expensive one.
 */
export async function buildMenuIndex({ branchId, type, at = new Date() }) {
  const menuType = { DELIVERY: "DELIVERY", PICKUP: "TAKEAWAY", DINE_IN: "DINE_IN" }[type] ?? "DINE_IN";

  let resolved = await getBranchMenu({ branchIdOrCode: branchId, type: menuType, at, includeUnavailable: true });
  // Most restaurants publish one menu; fall back rather than refusing to sell.
  if (!resolved.menu && menuType !== "DINE_IN") {
    resolved = await getBranchMenu({ branchIdOrCode: branchId, type: "DINE_IN", at, includeUnavailable: true });
  }

  const index = new Map();
  for (const section of resolved.sections) {
    for (const product of section.products) {
      for (const variant of product.variants) {
        index.set(variant.variantId, { price: variant.price, available: variant.available });
      }
    }
  }

  return { index, menu: resolved.menu, branch: resolved.branch };
}

// --- reads ------------------------------------------------------------------

/**
 * The order channel a client maps to.
 *
 * `ClientType` describes the software making the request; `OrderChannel`
 * describes how the order reached the restaurant, and promotions target the
 * latter. They are close enough to be confused and different enough that
 * confusing them means a mobile-only offer never fires.
 */
export function orderChannelFor(client) {
  switch (String(client ?? "").toUpperCase()) {
    case "IOS":
    case "ANDROID":
      return "MOBILE_APP";
    case "POS":
    case "KIOSK":
      return "POS";
    default:
      return "WEB";
  }
}

/**
 * The cart as the customer sees it: live prices, live availability, live totals.
 *
 * A line whose product vanished or sold out is returned with a `problem` rather
 * than throwing. Someone opening a week-old cart should see "two of these are
 * unavailable", not an error page — and checkout is where it becomes a refusal.
 */
export async function getPricedCart({ cart, at = new Date(), channel = "WEB" }) {
  const empty = {
    ...cart,
    branch: null,
    items: [],
    problems: [],
    totals: null,
  };

  if (!cart.items.length) return { ...empty, totals: zeroTotals() };
  if (!cart.branchId) {
    // No branch chosen yet: show what is in the basket, but nothing can be
    // priced, because price is a property of a branch's menu.
    return {
      ...cart,
      branch: null,
      items: cart.items.map((item) => ({ ...item, problem: "NO_BRANCH_SELECTED" })),
      problems: ["NO_BRANCH_SELECTED"],
      totals: zeroTotals(),
    };
  }

  const [{ index, menu, branch }, settings] = await Promise.all([
    buildMenuIndex({ branchId: cart.branchId, type: cart.type, at }),
    getSettings({ branchId: cart.branchId }),
  ]);

  const lines = [];
  const problems = [];
  const shown = [];

  for (const item of cart.items) {
    try {
      const resolved = await resolveLine({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        modifiers: item.modifiers ?? [],
        comboSelections: item.comboSelections ?? [],
        menuIndex: index,
      });

      lines.push({
        ...resolved,
        cartItemId: item.id,
        notes: item.notes,
        unitPrice: resolved.unitPrice + resolved.comboSurcharge,
        taxRates: [],
      });
    } catch (error) {
      const problem = error?.expected ? error.message : "This item is unavailable";
      problems.push({ cartItemId: item.id, productId: item.productId, message: problem });
      shown.push({ ...item, problem });
    }
  }

  // Give the unusable lines the same identifying fields the priced ones carry.
  //
  // They come straight off the cart row, which holds ids and nothing else, so
  // without this a client gets two different shapes under one `items` key and
  // renders a nameless row for the item it most needs to explain. One query,
  // and only when something is actually wrong.
  if (shown.length) {
    const products = await prisma.product.findMany({
      where: { id: { in: [...new Set(shown.map((item) => item.productId))] } },
      select: { id: true, name: true, slug: true, imageUrl: true, variants: { select: { id: true, name: true } } },
    });
    const byId = new Map(products.map((product) => [product.id, product]));

    for (const item of shown) {
      const product = byId.get(item.productId);
      item.name = product?.name ?? "This item";
      item.slug = product?.slug ?? null;
      item.imageUrl = product?.imageUrl ?? null;
      item.variantName = product?.variants.find((variant) => variant.id === item.variantId)?.name ?? null;
    }
  }

  await attachTaxRates(lines);

  // Priced twice, deliberately. A promotion that targets specific products has
  // to be measured against what those lines are actually worth — modifiers,
  // quantities and all — and that is the pricing engine's answer, not something
  // to approximate here. So the basket is priced once to get those line totals,
  // the offers are resolved against them, and it is priced again with the
  // discounts in. Both passes are pure arithmetic on data already in memory.
  const preview = priceOrder({ lines, type: cart.type, settings });

  // Offers are resolved against the live basket every time it is read, so the
  // cart shows the same discount the checkout will actually give. A failure to
  // resolve them must not take the basket down with it: a customer who cannot
  // see their food is a lost order, whereas a customer who does not see a
  // discount until the next refresh has merely been under-served.
  const { discounts, rejected } = await resolveCartDiscounts({
    cart,
    lines: preview.lines,
    subtotal: preview.subtotal,
    settings,
    at,
    channel,
  });

  const priced = priceOrder({ lines, type: cart.type, settings, discounts });

  return {
    ...cart,
    branch,
    menuId: menu?.id ?? null,
    items: [
      ...priced.lines.map((line) => ({
        id: line.cartItemId,
        productId: line.productId,
        variantId: line.variantId,
        name: line.name,
        slug: line.slug,
        imageUrl: line.imageUrl,
        variantName: line.variantName,
        quantity: line.quantity,
        notes: line.notes,
        unitPrice: line.unitPrice,
        modifierTotal: line.modifierTotal,
        lineTotal: line.lineSubtotal,
        modifiers: line.modifiers,
        comboSelections: line.comboSelections,
      })),
      ...shown,
    ],
    problems,
    discounts: priced.discounts.map((discount) => ({
      source: discount.source,
      label: discount.label,
      code: discount.code ?? null,
      amount: discount.amount,
      appliesTo: discount.appliesTo,
    })),
    rejectedDiscounts: rejected,
    totals: {
      subtotal: priced.subtotal,
      discountTotal: priced.discountTotal,
      taxTotal: priced.taxTotal,
      deliveryFee: priced.deliveryFee,
      packagingFee: priced.packagingFee,
      serviceCharge: priced.serviceCharge,
      roundOff: priced.roundOff,
      grandTotal: priced.grandTotal,
      pricesIncludeTax: priced.pricesIncludeTax,
      itemCount: priced.lines.reduce((total, line) => total + line.quantity, 0),
    },
    minimumOrderAmount: settings["ordering.min_order_amount"] ?? 0,
  };
}

/**
 * The offers that apply to a basket right now.
 *
 * Wrapped so a broken promotion can never break the cart. The rules engine is
 * pure and well tested, but it reads operator-authored rows, and an offer
 * someone mis-configured at 2am must cost the restaurant a discount, not the
 * whole checkout.
 */
async function resolveCartDiscounts({ cart, lines, subtotal, settings, at, channel = "WEB" }) {
  if (settings["pricing.promotions_enabled"] === false && !cart.couponCode) {
    return { discounts: [], rejected: [] };
  }

  try {
    const branch = await prisma.branch.findUnique({
      where: { id: cart.branchId },
      select: { id: true, timezone: true },
    });

    const coupons = [];
    const rejected = [];

    if (cart.couponCode) {
      const result = await validateCoupon({ code: cart.couponCode, userId: cart.userId, at });
      if (result.valid) coupons.push(result.coupon);
      else rejected.push({ code: result.code, reason: "COUPON_INVALID", message: result.message });
    }

    const resolved = await resolveOrderDiscounts({
      branchId: cart.branchId,
      branchTimezone: branch?.timezone ?? "UTC",
      orderType: cart.type,
      channel,
      lines,
      subtotal,
      userId: cart.userId,
      coupons,
      at,
    });

    return { discounts: resolved.discounts, rejected: [...rejected, ...resolved.rejected] };
  } catch (error) {
    logger.error("cart discount resolution failed", { cartId: cart.id, error: error.message });
    return { discounts: [], rejected: [] };
  }
}

function zeroTotals() {
  return {
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    packagingFee: 0,
    serviceCharge: 0,
    roundOff: 0,
    grandTotal: 0,
    itemCount: 0,
  };
}

/** Loads each line's tax rates in one query rather than one per line. */
export async function attachTaxRates(lines) {
  const groupIds = [...new Set(lines.map((line) => line.taxGroupId).filter(Boolean))];
  if (!groupIds.length) return lines;

  const groups = await prisma.taxGroup.findMany({
    where: { id: { in: groupIds }, isActive: true },
    select: {
      id: true,
      rates: {
        where: { isActive: true },
        select: { id: true, name: true, rate: true, isCompound: true, sortOrder: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  const byId = new Map(groups.map((group) => [group.id, group.rates]));
  for (const line of lines) line.taxRates = byId.get(line.taxGroupId) ?? [];

  return lines;
}

// --- writes -----------------------------------------------------------------

async function touch(cartId, data = {}) {
  return prisma.cart.update({
    where: { id: cartId },
    data: { ...data, expiresAt: expiryFrom() },
    select: CART_SELECT,
  });
}

/** Sets the branch and order type — which together decide every price. */
export async function setCartContext({ cart, branchId, type }) {
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });
  }

  return touch(cart.id, {
    ...(branchId !== undefined ? { branchId } : {}),
    ...(type !== undefined ? { type } : {}),
  });
}

/**
 * The outlet to use when nobody named one.
 *
 * A restaurant with a single active outlet has no choice to make, and an API
 * that demands one anyway forces every client to discover the branch list and
 * resolve it before the first Add — which the website does, but which is easy
 * for a second client to get wrong and impossible for a customer to fix. With
 * two or more outlets there is a real question and the caller must answer it:
 * branch decides the prices, the kitchen and the delivery area, so guessing
 * would quote one outlet's menu for another's food.
 */
async function soleBranchId() {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
    // Two is enough to know whether there is a choice to make.
    take: 2,
  });

  return branches.length === 1 ? branches[0].id : null;
}

export async function addItem({ cart, input, at = new Date() }) {
  const branchId = input.branchId ?? cart.branchId ?? (await soleBranchId());
  if (!branchId) {
    throw ApiError.validation("Choose a branch before adding items", { branchId: ["Required"] });
  }

  const type = input.type ?? cart.type;
  const { index } = await buildMenuIndex({ branchId, type, at });

  // Validated before it is stored: an invalid line must never reach the cart,
  // or every later read has to cope with it.
  const resolved = await resolveLine({
    productId: input.productId,
    variantId: input.variantId,
    quantity: input.quantity,
    modifiers: input.modifiers ?? [],
    comboSelections: input.comboSelections ?? [],
    menuIndex: index,
  });

  const candidate = {
    productId: resolved.productId,
    variantId: resolved.variantId,
    notes: input.notes ?? null,
    modifiers: (input.modifiers ?? []).map((m) => ({ optionId: m.optionId, quantity: m.quantity ?? 1 })),
    comboSelections: (input.comboSelections ?? []).map((c) => ({
      groupId: c.groupId,
      productId: c.productId,
      variantId: c.variantId ?? null,
      quantity: c.quantity ?? 1,
    })),
  };

  await withTransaction(async (tx) => {
    if (cart.branchId !== branchId || cart.type !== type) {
      // Switching branch invalidates every price in the basket, so the context
      // moves with the item rather than leaving a half-priced cart behind.
      await tx.cart.update({ where: { id: cart.id }, data: { branchId, type } });
    }

    const existing = cart.items.find((item) => sameLine(item, candidate));

    if (existing) {
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity: Math.min(existing.quantity + input.quantity, 99) },
      });
    } else {
      await tx.cartItem.create({
        data: {
          cartId: cart.id,
          productId: candidate.productId,
          variantId: candidate.variantId,
          quantity: input.quantity,
          notes: candidate.notes,
          modifiers: candidate.modifiers.length ? candidate.modifiers : undefined,
          comboSelections: candidate.comboSelections.length ? candidate.comboSelections : undefined,
        },
      });
    }

    await tx.cart.update({ where: { id: cart.id }, data: { expiresAt: expiryFrom() } });
  });

  // Adding from a creator's video is what creates an attribution — a view never
  // does. Recorded after the item is safely in the basket and deliberately
  // unable to fail it: losing a marketing attribution is a far smaller problem
  // than a shopper who cannot buy.
  if (input.creatorVideoId) {
    const { recordAddToCart } = await import("@/server/services/creator-attribution.service");
    await recordAddToCart({
      cart,
      videoId: input.creatorVideoId,
      surface: input.creatorSurface ?? "PRODUCT_PAGE",
      shareLinkId: input.creatorShareLinkId ?? null,
      sessionId: cart.sessionId ?? null,
    });
  }

  return prisma.cart.findUnique({ where: { id: cart.id }, select: CART_SELECT });
}

export async function updateItem({ cart, itemId, quantity, notes }) {
  const item = cart.items.find((row) => row.id === itemId);
  if (!item) throw ApiError.notFound("That item is not in your cart");

  if (quantity === 0) return removeItem({ cart, itemId });

  await prisma.cartItem.update({
    where: { id: itemId },
    data: { ...(quantity !== undefined ? { quantity } : {}), ...(notes !== undefined ? { notes } : {}) },
  });

  return touch(cart.id);
}

export async function removeItem({ cart, itemId }) {
  const item = cart.items.find((row) => row.id === itemId);
  if (!item) throw ApiError.notFound("That item is not in your cart");

  await prisma.cartItem.delete({ where: { id: itemId } });
  return touch(cart.id);
}

/**
 * Empties the cart.
 *
 * Creator attributions are cleared with it, by the user's own rule: emptying
 * the basket ends the attribution rather than letting a video keep credit for
 * a basket the customer abandoned.
 */
export async function clearCart({ cart }) {
  await withTransaction(async (tx) => {
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.creatorAttribution.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
  });

  return prisma.cart.findUnique({ where: { id: cart.id }, select: CART_SELECT });
}

/**
 * Puts a code on the cart.
 *
 * Validated here so the customer is told immediately, but only the *code* is
 * stored — never the discount it was worth. The basket can change after the
 * code goes on, and a stored amount would go stale the moment it did. Every
 * read re-resolves it, so what the cart shows is always what checkout will give.
 *
 * A code that is valid but worth nothing on the current basket is still
 * accepted, with the reason attached: "add 500 more to use this" is a useful
 * thing to tell someone, and refusing the code outright would hide it.
 */
export async function applyCouponToCart({ cart, code, at = new Date() }) {
  const result = await validateCoupon({ code, userId: cart.userId, at });
  if (!result.valid) throw ApiError.validation(result.message, { code: [result.message] });

  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: result.coupon.code } });
  return prisma.cart.findUnique({ where: { id: cart.id }, select: CART_SELECT });
}

export async function removeCouponFromCart({ cart }) {
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
  return prisma.cart.findUnique({ where: { id: cart.id }, select: CART_SELECT });
}

/** Housekeeping: abandoned carts do not need to live forever. */
export async function pruneExpiredCarts(now = new Date()) {
  const result = await prisma.cart.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
}

export { CART_SELECT, resolveLine, expiryFrom, sameLine };
