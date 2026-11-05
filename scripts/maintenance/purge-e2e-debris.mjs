/**
 * Removes rows left behind by e2e suites that crashed before their teardown.
 *
 * Nothing here is inferred: a row is only touched when it carries one of the
 * suites' own markers — the `e2eNN-<timestamp>-` email tag, the `E2ED` branch
 * code prefix, or a name/slug carrying a run's timestamp. Real accounts,
 * branches and catalogue rows are never matched by those.
 *
 * Run with:  node --env-file=.env scripts/maintenance/purge-e2e-debris.mjs
 * Add --dry  to list what would go without deleting anything.
 */
import { PrismaClient } from "../../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const dryRun = process.argv.includes("--dry");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const users = await prisma.user.findMany({
  where: { email: { contains: "@example.test" } },
  select: { id: true, email: true },
});
const userIds = users.map((row) => row.id);

const branches = await prisma.branch.findMany({
  where: { code: { startsWith: "E2ED" } },
  select: { id: true, code: true, name: true },
});
const branchIds = branches.map((row) => row.id);

const creators = await prisma.creatorProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
const creatorIds = creators.map((row) => row.id);

const orders = await prisma.order.findMany({
  where: { OR: [{ branchId: { in: branchIds } }, { userId: { in: userIds } }] },
  select: { id: true, orderNumber: true },
});
const orderIds = orders.map((row) => row.id);

// The suites stamp every fixture they create with `Date.now()`, so a 13-digit
// run timestamp in a slug, version or name is the marker. Nothing a person
// would type looks like that.
const STAMP = "[0-9]{13}";

const termsRows = await prisma.creatorTerms.findMany({ select: { id: true, version: true } });
const debrisTerms = termsRows.filter((row) => new RegExp(`${STAMP}$`).test(row.version));

const productRows = await prisma.product.findMany({ select: { id: true, slug: true } });
const debrisProducts = productRows.filter((row) => new RegExp(`-${STAMP}$`).test(row.slug));

const categoryRows = await prisma.category.findMany({ select: { id: true, slug: true } });
const debrisCategories = categoryRows.filter((row) => new RegExp(`-${STAMP}$`).test(row.slug));

const promotionRows = await prisma.promotion.findMany({ select: { id: true, name: true } });
const debrisPromotions = promotionRows.filter((row) => new RegExp(`${STAMP}$`).test(row.name));

const taxRows = await prisma.taxGroup.findMany({ select: { id: true, name: true } });
const debrisTaxGroups = taxRows.filter((row) => new RegExp(`${STAMP}$`).test(row.name));

const carts = await prisma.cart.findMany({
  where: { OR: [{ branchId: { in: branchIds } }, { userId: { in: userIds } }] },
  select: { id: true },
});
const cartIds = carts.map((row) => row.id);

console.log("Would remove:");
console.log("  users    ", users.length, users.map((u) => u.email).slice(0, 5).join(", ") + (users.length > 5 ? " …" : ""));
console.log("  branches ", branches.length, branches.map((b) => `${b.code} ${b.name}`).join(", "));
console.log("  creators ", creators.length);
console.log("  orders   ", orders.length, orders.map((o) => o.orderNumber).slice(0, 5).join(", "));
console.log("  carts    ", carts.length);
console.log("  terms    ", debrisTerms.length, debrisTerms.map((t) => t.version).join(", "));
console.log("  products ", debrisProducts.length, debrisProducts.map((p) => p.slug).join(", "));
console.log("  categories", debrisCategories.length, debrisCategories.map((c) => c.slug).join(", "));
console.log("  promotions", debrisPromotions.length, debrisPromotions.map((p) => p.name).join(", "));
console.log("  taxGroups", debrisTaxGroups.length, debrisTaxGroups.map((t) => t.name).join(", "));

if (dryRun) {
  await prisma.$disconnect();
  process.exit(0);
}

const removed = {};
const run = async (label, promise) => {
  removed[label] = (await promise).count;
};

// Creator graph, deepest first.
await run("shareLinkClicks", prisma.creatorShareLinkClick.deleteMany({ where: { shareLink: { creatorId: { in: creatorIds } } } }));
await run("shareLinks", prisma.creatorShareLink.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("videoViews", prisma.creatorVideoView.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } }));
await run("videoLikes", prisma.creatorVideoLike.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } }));
await run("videoShares", prisma.creatorVideoShare.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } }));
await run("videoDailyStats", prisma.creatorVideoDailyStat.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } }));
await run("walletTxns", prisma.creatorWalletTransaction.deleteMany({ where: { wallet: { creatorId: { in: creatorIds } } } }));
await run("wallets", prisma.creatorWallet.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("earnings", prisma.creatorEarning.deleteMany({ where: { OR: [{ creatorId: { in: creatorIds } }, { orderId: { in: orderIds } }] } }));
await run("orderAttributions", prisma.creatorOrderAttribution.deleteMany({ where: { OR: [{ creatorId: { in: creatorIds } }, { orderId: { in: orderIds } }] } }));
await run("attributionTouches", prisma.creatorAttributionTouch.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("attributions", prisma.creatorAttribution.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("appreciations", prisma.creatorAppreciation.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("strikes", prisma.creatorStrike.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("videoReviews", prisma.creatorVideoReview.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } }));
await run("videoAssets", prisma.creatorVideoAsset.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } }));
await run("videos", prisma.creatorVideo.deleteMany({ where: { OR: [{ creatorId: { in: creatorIds } }, { orderId: { in: orderIds } }] } }));
await run("termsAcceptances", prisma.creatorTermsAcceptance.deleteMany({ where: { creatorId: { in: creatorIds } } }));
await run("creators", prisma.creatorProfile.deleteMany({ where: { id: { in: creatorIds } } }));

// Orders and everything hanging off them.
const journalWhere = { OR: [{ branchId: { in: branchIds } }, { orderId: { in: orderIds } }] };
await run("journalLines", prisma.journalLine.deleteMany({ where: { entry: journalWhere } }));
await run("journalEntries", prisma.journalEntry.deleteMany({ where: journalWhere }));
await run("stockMovements", prisma.stockMovement.deleteMany({ where: { branchId: { in: branchIds } } }));
await run("orderStatusEvents", prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } }));
await run("orderItemModifiers", prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } }));
await run("orderItems", prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }));
await run("orderDiscounts", prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } }));
await run("orderTaxLines", prisma.orderTaxLine.deleteMany({ where: { orderId: { in: orderIds } } }));
await run("invoices", prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }));
await run("payments", prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }));
await run("orders", prisma.order.deleteMany({ where: { id: { in: orderIds } } }));

await run("cartItems", prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } }));
await run("carts", prisma.cart.deleteMany({ where: { id: { in: cartIds } } }));

// Catalogue and menus belonging to those branches.
await run("menuItems", prisma.menuItem.deleteMany({ where: { section: { menu: { branchId: { in: branchIds } } } } }));
await run("menuSections", prisma.menuSection.deleteMany({ where: { menu: { branchId: { in: branchIds } } } }));
await run("menus", prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } }));

// Accounts, tokens and grants.
await run("numberSequences", prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } }));
await run("addresses", prisma.address.deleteMany({ where: { userId: { in: userIds } } }));
await run("notifications", prisma.notification.deleteMany({ where: { userId: { in: userIds } } }));
await run("auditLogs", prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { branchId: { in: branchIds } }] } }));
await run("credentialTokens", prisma.credentialToken.deleteMany({ where: { userId: { in: userIds } } }));
await run("refreshTokens", prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }));
await run("roleAssignments", prisma.userRoleAssignment.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { branchId: { in: branchIds } }] } }));
await run("permissionOverrides", prisma.userPermissionOverride.deleteMany({ where: { userId: { in: userIds } } }));
await run("users", prisma.user.deleteMany({ where: { id: { in: userIds } } }));
await run("branchHours", prisma.branchHour.deleteMany({ where: { branchId: { in: branchIds } } }));
await run("branches", prisma.branch.deleteMany({ where: { id: { in: branchIds } } }));

// Stamped catalogue, offers and terms, deepest first.
const debrisProductIds = debrisProducts.map((row) => row.id);
const debrisPromotionIds = debrisPromotions.map((row) => row.id);
await run("couponRedemptions", prisma.couponRedemption.deleteMany({ where: { coupon: { promotionId: { in: debrisPromotionIds } } } }));
await run("coupons", prisma.coupon.deleteMany({ where: { promotionId: { in: debrisPromotionIds } } }));
await run("promotionTargets", prisma.promotionTarget.deleteMany({ where: { promotionId: { in: debrisPromotionIds } } }));
await run("promotions", prisma.promotion.deleteMany({ where: { id: { in: debrisPromotionIds } } }));
await run("productVariants", prisma.productVariant.deleteMany({ where: { productId: { in: debrisProductIds } } }));
await run("products", prisma.product.deleteMany({ where: { id: { in: debrisProductIds } } }));
await run("categories", prisma.category.deleteMany({ where: { id: { in: debrisCategories.map((row) => row.id) } } }));
await run("taxRates", prisma.taxRate.deleteMany({ where: { groupId: { in: debrisTaxGroups.map((row) => row.id) } } }));
await run("taxGroups", prisma.taxGroup.deleteMany({ where: { id: { in: debrisTaxGroups.map((row) => row.id) } } }));
await run("creatorTerms", prisma.creatorTerms.deleteMany({ where: { id: { in: debrisTerms.map((row) => row.id) } } }));

console.log("\nRemoved:", JSON.stringify(removed, null, 1));
await prisma.$disconnect();
