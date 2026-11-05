import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { branchFilter } from "@/server/access/scope";
import { CART_SELECT, getPricedCart } from "@/server/services/cart.service";

/**
 * Live carts — support tooling, not analytics.
 *
 * The question this answers is "somebody rang to say they cannot check out,
 * what are they looking at?", so it is deliberately a read-only window onto a
 * basket in progress. Nothing here mutates a shopper's cart: a member of staff
 * silently changing what is in somebody's basket while they are looking at it
 * is a support tool that creates support calls.
 *
 * **Empty carts are excluded by default.** A cart row is created the moment
 * anybody touches the storefront, so the unfiltered table is mostly rows with
 * nothing in them — and a list that is 95% noise is one nobody reads.
 *
 * A cart with no branch is a shopper who has not picked an outlet yet. It
 * belongs to no branch, so branch scoping cannot place it and it stays visible
 * to anyone who may read carts at all. Hiding it would mean nobody could ever
 * help them.
 */

const LIST_SELECT = {
  id: true,
  userId: true,
  sessionId: true,
  branchId: true,
  type: true,
  couponCode: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
  // `CartItem.productId` is a loose column with no relation behind it, so the
  // names are looked up afterwards rather than joined.
  items: { select: { id: true, quantity: true, productId: true }, orderBy: { createdAt: "asc" } },
};

export async function listCarts({
  branchId,
  type,
  identity,
  search,
  includeEmpty = false,
  staleMinutes = null,
  scope = null,
  limit = 25,
  cursor,
} = {}) {
  const filter = branchFilter(scope);
  const since = staleMinutes ? new Date(Date.now() - staleMinutes * 60_000) : null;

  const rows = await prisma.cart.findMany({
    where: {
      // A cart with no branch belongs to nobody, so the wall cannot place it.
      ...(filter ? { OR: [{ branchId: filter }, { branchId: null }] } : {}),
      ...(branchId ? { branchId } : {}),
      ...(type ? { type } : {}),
      ...(includeEmpty ? {} : { items: { some: {} } }),
      ...(identity === "SIGNED_IN" ? { userId: { not: null } } : {}),
      ...(identity === "GUEST" ? { userId: null } : {}),
      ...(since ? { updatedAt: { lt: since } } : {}),
      ...(search
        ? {
            OR: [
              { user: { name: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { user: { phone: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: LIST_SELECT,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);

  // Neither `branchId` nor `productId` has a relation behind it, so both sets
  // of names are looked up rather than joined.
  const branchIds = [...new Set(page.items.map((row) => row.branchId).filter(Boolean))];
  const productIds = [...new Set(page.items.flatMap((row) => row.items.map((line) => line.productId)))];
  const [branches, products] = await Promise.all([
    branchIds.length ? prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : [],
    productIds.length ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : [],
  ]);
  const branchById = Object.fromEntries(branches.map((row) => [row.id, row]));
  const productById = Object.fromEntries(products.map((row) => [row.id, row.name]));

  return {
    ...page,
    items: page.items.map(({ items, ...cart }) => ({
      branch: cart.branchId ? (branchById[cart.branchId] ?? null) : null,
      ...cart,
      lineCount: items.length,
      unitCount: items.reduce((total, line) => total + line.quantity, 0),
      // Named rather than priced: the real total needs the pricing engine and
      // the live menu, which is a per-cart job, not a per-row one.
      products: items.slice(0, 4).map((line) => ({
        name: productById[line.productId] ?? "An item that is no longer on the menu",
        quantity: line.quantity,
      })),
    })),
  };
}

/**
 * One cart, priced the way the shopper sees it.
 *
 * Run through the same pricing engine as checkout rather than summing list
 * prices, because the whole reason somebody rings is that their total is not
 * what they expected — and a support screen showing a different number from
 * the customer's screen is worse than no screen.
 */
export async function getCartDetail(id) {
  const cart = await prisma.cart.findUnique({ where: { id }, select: CART_SELECT });
  if (!cart) throw ApiError.notFound("Cart not found");

  const productIds = [...new Set((cart.items ?? []).map((line) => line.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const productById = Object.fromEntries(products.map((row) => [row.id, row.name]));
  const items = (cart.items ?? []).map((line) => ({ ...line, productName: productById[line.productId] ?? null }));

  const owner = cart.userId
    ? await prisma.user.findUnique({ where: { id: cart.userId }, select: { id: true, name: true, email: true, phone: true } })
    : null;
  const branch = cart.branchId
    ? await prisma.branch.findUnique({ where: { id: cart.branchId }, select: { id: true, name: true, currency: true } })
    : null;

  // Pricing needs a branch and a menu. A cart that has not picked an outlet
  // cannot be priced at all, and saying so is better than showing zero.
  let priced = null;
  let pricingError = null;
  if (cart.branchId) {
    try {
      priced = await getPricedCart({ cart, channel: "WEB" });
    } catch (error) {
      pricingError = error?.message ?? "This cart cannot be priced right now.";
    }
  }

  return { cart: { ...cart, items }, owner, branch, priced, pricingError };
}

/** How many carts are sitting there with something in them. */
export async function cartSummary({ scope = null, staleMinutes = 30 } = {}) {
  const filter = branchFilter(scope);
  const where = {
    ...(filter ? { OR: [{ branchId: filter }, { branchId: null }] } : {}),
    items: { some: {} },
  };
  const since = new Date(Date.now() - staleMinutes * 60_000);

  const [active, stale, guests] = await Promise.all([
    prisma.cart.count({ where }),
    prisma.cart.count({ where: { ...where, updatedAt: { lt: since } } }),
    prisma.cart.count({ where: { ...where, userId: null } }),
  ]);

  return { active, stale, guests, signedIn: active - guests, staleMinutes };
}
