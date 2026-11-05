import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";
import { checkPages, cookiesFrom, openPhone } from "./lib/browser.mjs";

/**
 * Does the Marketing section hold together on a phone?
 *
 * The promotion form is the hardest layout in the product: a two-column
 * builder with a sticky summary beside it, several rows of checkbox chips,
 * and a repeating target list. On a phone the column has to collapse and
 * the chips have to wrap, and neither is visible from a desk monitor.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const short = String(stamp).slice(-5);
const emailOf = (name) => `mob20-${stamp}-${name}@example.test`;
const made = { userIds: new Set(), branchIds: new Set(), promotionIds: new Set(), categoryIds: new Set() };

let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 240)}`);
  }
};

let ip = 0;
const nextIp = () => `10.94.${(++ip >> 8) & 255}.${ip & 255}`;

async function api(pathname, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  const reg = await api("/auth/register", { method: "POST", body: { name: "mobmk", email: emailOf("admin"), password: "mobile-passphrase-20" } });
  const userId = reg.body?.data?.user?.id;
  if (!userId) throw new Error(`could not register: ${JSON.stringify(reg.body)}`);
  made.userIds.add(userId);
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE", isSuperAdmin: true } });

  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email: emailOf("admin"), password: "mobile-passphrase-20", client: "WEB" }),
  });
  const cookies = cookiesFrom(login);
  const token = (await login.json())?.data?.accessToken;

  const branch = await api("/admin/branches", { method: "POST", token, body: { code: `P${short}`, name: `Mob20 Branch With A Fairly Long Name ${short}`, city: "Karachi", timezone: "Asia/Karachi" } });
  made.branchIds.add(branch.body.data.id);
  const category = await api("/admin/categories", { method: "POST", token, body: { name: `Mob20 Mains ${short}` } });
  made.categoryIds.add(category.body.data.id);

  // An offer using every awkward field at once: a long name, a time window
  // past midnight, several targets, and the whole set of conditions.
  const offer = await api("/admin/promotions", {
    method: "POST",
    token,
    body: {
      name: `Mob20 Late night half price on everything except the drinks ${short}`,
      description: "A deliberately long description so the summary column has something to wrap.",
      type: "BUY_X_GET_Y",
      buyQuantity: 2,
      getQuantity: 1,
      maxDiscountAmount: 500,
      minOrderAmount: 1500,
      minItemCount: 3,
      branchIds: [branch.body.data.id],
      channels: ["WEB", "MOBILE_APP", "QR", "POS"],
      orderTypes: ["DELIVERY", "PICKUP"],
      daysOfWeek: [4, 5, 6],
      startMinute: 1380,
      endMinute: 1560,
      usageLimit: 500,
      usageLimitPerUser: 2,
      requiresCoupon: true,
      targets: [{ targetType: "CATEGORY", targetId: category.body.data.id, role: "BUY" }],
    },
  });
  const offerId = offer.body?.data?.id;
  if (offerId) made.promotionIds.add(offerId);

  const plain = await api("/admin/promotions", {
    method: "POST",
    token,
    body: { name: `Mob20 Chain-wide ${short}`, type: "PERCENTAGE", value: 10, branchIds: [] },
  });
  if (plain.body?.data?.id) made.promotionIds.add(plain.body.data.id);

  // A batch, so the coupon list has rows and a revoke panel to render.
  await api("/admin/coupons/generate", {
    method: "POST",
    token,
    body: { promotionId: offerId, count: 12, prefix: "MOB", length: 7, campaign: `mob20-${short}` },
  });

  const phone = await openPhone({ cookies });

  const screens = [
    "/dashboard/promotions",
    "/dashboard/promotions?state=live",
    "/dashboard/promotions/new",
    `/dashboard/promotions/${offerId}`,
    "/dashboard/coupons",
    `/dashboard/coupons?campaign=mob20-${short}`,
    `/dashboard/coupons?promotion=${offerId}`,
  ];

  await checkPages({ phone, base: BASE, screens, check });
  await phone.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const branchIds = [...made.branchIds];
  const promotionIds = (await prisma.promotion.findMany({ where: { name: { contains: short } }, select: { id: true } })).map((r) => r.id);
  await prisma.couponRedemption.deleteMany({ where: { coupon: { promotionId: { in: promotionIds } } } });
  await prisma.coupon.deleteMany({ where: { promotionId: { in: promotionIds } } });
  await prisma.promotionTarget.deleteMany({ where: { promotionId: { in: promotionIds } } });
  await prisma.promotion.deleteMany({ where: { id: { in: promotionIds } } });
  await prisma.category.deleteMany({ where: { id: { in: [...made.categoryIds] } } });
  await prisma.outboxEvent.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [...made.userIds] } }, { branchId: { in: branchIds } }] } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.userDevice.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: [...made.userIds] } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...made.userIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  console.log("REMAINING", JSON.stringify({ users: await prisma.user.count(), branches: await prisma.branch.count(), promotions: await prisma.promotion.count(), coupons: await prisma.coupon.count() }));
}

try {
  await main();
} catch (error) {
  console.error("MOBILE RUN CRASHED", error);
  failures.push("crashed");
} finally {
  await cleanup().catch((error) => console.error("CLEANUP FAILED", error));
  await prisma.$disconnect();
}

process.exit(failures.length ? 1 : 0);
