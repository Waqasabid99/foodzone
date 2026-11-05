import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { phoneKey } from "@/lib/phone-key";

/**
 * Customers: who has ordered, how often, and what they spent.
 *
 * Two kinds of customer share this screen, because a restaurant has two kinds:
 *
 *   * **Accounts** — someone who registered. A real record that can be edited,
 *     suspended or deleted, with addresses and reviews attached.
 *   * **Guests** — phone, counter and QR orders placed without signing in.
 *     There is no account behind them, so they are assembled from the orders
 *     themselves and grouped by phone number. Nothing about them can be
 *     edited: the only record is the orders.
 *
 * Phone numbers are typed by whoever took the order, so "+92 300 1234567" and
 * "03001234567" are the same person and must group as one. `phoneKey` reduces
 * both to the last ten digits, and the same reduction runs in SQL so the
 * grouping and the matching agree. A guest phone that belongs to an account is
 * attributed to that account rather than listed twice.
 *
 * Everything is narrowed by the branches the caller may read customers at.
 * A manager of one outlet sees the people who have ordered there, and their
 * orders at that outlet — not the company's whole customer list.
 */

/** Orders that never happened, and so are not what someone bought. */
const VOID_STATUSES = ["DRAFT", "CANCELLED", "REJECTED"];
/** Money returned is not money spent, but the order still happened. */
const UNSPENT_STATUSES = [...VOID_STATUSES, "REFUNDED"];

const CUSTOMER_ROLE_KEY = "customer";

/**
 * The reduction `phoneKey` does, in SQL.
 *
 * Orders carry `guestPhoneKey`, written and indexed on create, so only the
 * `User` side needs reducing here — and that is matched by equality against a
 * single key rather than scanned.
 */
const phoneKeySql = (column) => Prisma.sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 10)`;

function branchCondition(scope, column = Prisma.sql`o."branchId"`) {
  if (!scope || scope.all) {
    return scope?.except?.length ? Prisma.sql`${column} <> ALL(${scope.except})` : Prisma.sql`TRUE`;
  }
  // An empty scope matches nothing, which is the honest answer to "which
  // branches may they read?" when the answer is none.
  return scope.ids.length ? Prisma.sql`${column} = ANY(${scope.ids})` : Prisma.sql`FALSE`;
}

/**
 * One row per customer, accounts and guests together, newest activity first.
 *
 * Written as SQL because the ordering ("who ordered most recently") and the
 * figures beside each name are aggregates over orders, and because the two
 * kinds of customer come from different tables. Fetching a page of users and
 * then their orders would sort by the wrong thing and still cost a second
 * query per page.
 */
export async function listCustomers({ search = null, kind = null, scope = null, limit = 25, offset = 0 } = {}) {
  const branchWhere = branchCondition(scope);
  const term = search?.trim() ? `%${search.trim()}%` : null;
  const searchDigits = search?.trim() ? phoneKey(search) : "";

  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH scoped AS (
      SELECT o."userId", o."guestName", o."guestPhone", o."guestEmail", o."grandTotal", o."placedAt", o."status",
             o."guestPhoneKey" AS phone_key
      FROM "Order" o
      WHERE ${branchWhere} AND o."status" <> ALL(${VOID_STATUSES})
    ),
    account_stats AS (
      SELECT s."userId" AS id,
             COUNT(*)::int AS orders,
             COALESCE(SUM(CASE WHEN s."status" <> ALL(${UNSPENT_STATUSES}) THEN s."grandTotal" ELSE 0 END), 0) AS spend,
             MAX(s."placedAt") AS last_order
      FROM scoped s WHERE s."userId" IS NOT NULL GROUP BY s."userId"
    ),
    -- A guest order whose phone belongs to an account counts towards it.
    guest_matched AS (
      SELECT u."id" AS id,
             COUNT(*)::int AS orders,
             COALESCE(SUM(CASE WHEN s."status" <> ALL(${UNSPENT_STATUSES}) THEN s."grandTotal" ELSE 0 END), 0) AS spend,
             MAX(s."placedAt") AS last_order
      FROM scoped s
      JOIN "User" u ON ${phoneKeySql(Prisma.sql`u."phone"`)} = s.phone_key AND u."phone" IS NOT NULL
      WHERE s."userId" IS NULL AND s.phone_key IS NOT NULL GROUP BY u."id"
    ),
    accounts AS (
      SELECT u."id",
             'ACCOUNT' AS kind,
             u."name", u."email", u."phone", u."status"::text AS status, u."createdAt" AS joined_at,
             COALESCE(a.orders, 0) + COALESCE(g.orders, 0) AS orders,
             COALESCE(a.spend, 0) + COALESCE(g.spend, 0) AS spend,
             GREATEST(COALESCE(a.last_order, '-infinity'::timestamp), COALESCE(g.last_order, '-infinity'::timestamp)) AS last_order,
             COALESCE(g.orders, 0) AS guest_orders
      FROM "User" u
      JOIN "UserRoleAssignment" ura ON ura."userId" = u."id"
      JOIN "Role" r ON r."id" = ura."roleId" AND r."key" = ${CUSTOMER_ROLE_KEY}
      LEFT JOIN account_stats a ON a.id = u."id"
      LEFT JOIN guest_matched g ON g.id = u."id"
      WHERE u."deletedAt" IS NULL
        AND (${scope === null || scope?.all ? Prisma.sql`TRUE` : Prisma.sql`(a.id IS NOT NULL OR g.id IS NOT NULL)`})
    ),
    guests AS (
      SELECT s.phone_key AS id,
             'GUEST' AS kind,
             (ARRAY_AGG(s."guestName" ORDER BY s."placedAt" DESC) FILTER (WHERE s."guestName" IS NOT NULL))[1] AS name,
             (ARRAY_AGG(s."guestEmail" ORDER BY s."placedAt" DESC) FILTER (WHERE s."guestEmail" IS NOT NULL))[1] AS email,
             (ARRAY_AGG(s."guestPhone" ORDER BY s."placedAt" DESC))[1] AS phone,
             NULL AS status,
             MIN(s."placedAt") AS joined_at,
             COUNT(*)::int AS orders,
             COALESCE(SUM(CASE WHEN s."status" <> ALL(${UNSPENT_STATUSES}) THEN s."grandTotal" ELSE 0 END), 0) AS spend,
             MAX(s."placedAt") AS last_order,
             0 AS guest_orders
      FROM scoped s
      WHERE s."userId" IS NULL AND s.phone_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."phone" IS NOT NULL AND ${phoneKeySql(Prisma.sql`u."phone"`)} = s.phone_key)
      GROUP BY s.phone_key
    ),
    everyone AS (
      SELECT * FROM accounts WHERE ${kind === "GUEST" ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
      UNION ALL
      SELECT * FROM guests WHERE ${kind === "ACCOUNT" ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
    ),
    matched AS (
      SELECT * FROM everyone
      WHERE ${
        term
          ? Prisma.sql`(name ILIKE ${term} OR email ILIKE ${term} OR (${
              searchDigits ? Prisma.sql`right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) LIKE ${`%${searchDigits}%`}` : Prisma.sql`FALSE`
            }))`
          : Prisma.sql`TRUE`
      }
    )
    SELECT *, COUNT(*) OVER ()::int AS total
    FROM matched
    ORDER BY last_order DESC NULLS LAST, joined_at DESC, name ASC
    LIMIT ${limit} OFFSET ${offset}`);

  return {
    items: rows.map(shapeRow),
    total: rows[0]?.total ?? 0,
  };
}

function shapeRow(row) {
  const lastOrder = row.last_order && row.last_order.getTime?.() > 0 ? row.last_order : null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name ?? (row.kind === "GUEST" ? "Guest" : "—"),
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status ?? null,
    joinedAt: row.joined_at ?? null,
    orders: Number(row.orders ?? 0),
    spend: Number(row.spend ?? 0),
    lastOrderAt: lastOrder,
    /** Orders this account placed without signing in, matched by phone. */
    guestOrders: Number(row.guest_orders ?? 0),
  };
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  type: true,
  paymentState: true,
  grandTotal: true,
  placedAt: true,
  userId: true,
  branch: { select: { id: true, name: true } },
  _count: { select: { items: true } },
};

function summarise(orders) {
  const counted = orders.filter((order) => !VOID_STATUSES.includes(order.status));
  const spent = counted.filter((order) => !UNSPENT_STATUSES.includes(order.status));
  const total = spent.reduce((sum, order) => sum + Number(order.grandTotal), 0);

  return {
    orders: counted.length,
    spend: total,
    averageOrder: spent.length ? total / spent.length : 0,
    firstOrderAt: counted.at(-1)?.placedAt ?? null,
    lastOrderAt: counted[0]?.placedAt ?? null,
    cancelled: orders.length - counted.length,
  };
}

/** How many orders they placed at each branch — where they actually eat. */
function byBranch(orders) {
  const map = new Map();
  for (const order of orders) {
    if (VOID_STATUSES.includes(order.status)) continue;
    const entry = map.get(order.branch.id) ?? { id: order.branch.id, name: order.branch.name, orders: 0 };
    entry.orders += 1;
    map.set(order.branch.id, entry);
  }
  return [...map.values()].sort((a, b) => b.orders - a.orders);
}

const MAX_ORDERS = 500;

/**
 * One account, with everything about them the caller may see.
 *
 * The orders are the branch-scoped ones, so the figures on this page and the
 * figures in the list agree: a branch manager is shown what this customer did
 * at their outlet, and nothing about the rest.
 */
export async function getCustomer(userId, { scope = null } = {}) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      locale: true,
      avatarUrl: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      isSuperAdmin: true,
      roleAssignments: { select: { role: { select: { key: true, name: true } } } },
      addresses: {
        where: { deletedAt: null },
        select: {
          id: true, label: true, recipientName: true, phone: true, line1: true, line2: true, landmark: true,
          city: true, state: true, postalCode: true, country: true, deliveryNote: true, isDefault: true,
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!user) throw ApiError.notFound("Customer not found");

  // Staff accounts are managed from Users, where roles and permissions live.
  if (!user.roleAssignments.some((assignment) => assignment.role.key === CUSTOMER_ROLE_KEY)) {
    throw ApiError.notFound("Customer not found");
  }

  const key = phoneKey(user.phone);
  const where = {
    AND: [
      branchScopeWhere(scope),
      {
        OR: [
          { userId: user.id },
          // Placed at the counter or by phone with this number, before or
          // instead of signing in — matched on the indexed key.
          ...(key ? [{ userId: null, guestPhoneKey: key }] : []),
        ],
      },
    ],
  };

  const [orders, reviews] = await Promise.all([
    prisma.order.findMany({ where, select: ORDER_SELECT, orderBy: { placedAt: "desc" }, take: MAX_ORDERS }),
    prisma.review.findMany({
      where: { userId: user.id },
      select: {
        id: true, rating: true, comment: true, status: true, createdAt: true,
        product: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true, branchId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // A branch-scoped caller may only open a customer who has ordered at one of
  // their branches. Without this, the list is scoped but any id typed into the
  // address bar is not.
  if (scope && !scope.all && !orders.length) throw ApiError.notFound("Customer not found");

  const { roleAssignments, isSuperAdmin, ...profile } = user;
  return {
    ...profile,
    kind: "ACCOUNT",
    roles: roleAssignments.map((assignment) => assignment.role.name),
    isStaff: isSuperAdmin || roleAssignments.some((assignment) => assignment.role.key !== CUSTOMER_ROLE_KEY && assignment.role.key !== "creator"),
    stats: summarise(orders),
    branches: byBranch(orders),
    guestOrders: orders.filter((order) => !order.userId).length,
    orders: orders.slice(0, 20),
    reviews: reviews.filter((review) => reviewInScope(review, scope)),
    truncated: orders.length === MAX_ORDERS,
  };
}

function branchScopeWhere(scope) {
  if (!scope || scope.all) return scope?.except?.length ? { branchId: { notIn: scope.except } } : {};
  return { branchId: { in: scope.ids } };
}

/** A review is shown where its order is; one with no order left is company-wide. */
function reviewInScope(review, scope) {
  if (!scope || scope.all) return !review.order?.branchId || !scope?.except?.includes(review.order.branchId);
  return review.order?.branchId ? scope.ids.includes(review.order.branchId) : false;
}

/**
 * One guest, assembled from their orders.
 *
 * Keyed by the phone number rather than by any record, because there is no
 * record. If the number has since been registered, the account is the answer
 * and the caller is pointed at it.
 */
export async function getGuestCustomer(phone, { scope = null } = {}) {
  const key = phoneKey(phone);
  if (!key) throw ApiError.notFound("Customer not found");

  // The stored numbers are formatted however they were typed, so the account
  // side is matched on the same reduction, in SQL.
  const registered = await prisma.$queryRaw(Prisma.sql`
    SELECT "id" FROM "User"
    WHERE "deletedAt" IS NULL AND "phone" IS NOT NULL AND ${phoneKeySql(Prisma.sql`"phone"`)} = ${key}
    LIMIT 1`);
  if (registered.length) return { kind: "ACCOUNT_EXISTS", userId: registered[0].id };

  const orders = await prisma.order.findMany({
    where: { AND: [branchScopeWhere(scope), { userId: null, guestPhoneKey: key }] },
    select: { ...ORDER_SELECT, guestPhone: true, guestName: true, guestEmail: true },
    orderBy: { placedAt: "desc" },
    take: MAX_ORDERS,
  });
  if (!orders.length) throw ApiError.notFound("Customer not found");

  return {
    kind: "GUEST",
    id: key,
    name: orders.find((order) => order.guestName)?.guestName ?? "Guest",
    phone: orders[0].guestPhone,
    email: orders.find((order) => order.guestEmail)?.guestEmail ?? null,
    stats: summarise(orders),
    branches: byBranch(orders),
    orders: orders.slice(0, 20).map(({ guestPhone: _p, guestName: _n, guestEmail: _e, ...order }) => order),
    truncated: orders.length === MAX_ORDERS,
  };
}

/**
 * Edits a customer's own details.
 *
 * Name, phone and language only. An email address is how someone signs in and
 * proves who they are, so changing it is a verification flow rather than a
 * text field a staff member overwrites.
 */
export async function updateCustomer(userId, data) {
  await assertCustomer(userId);

  if (data.phone) {
    const clash = await prisma.user.findFirst({
      where: { phone: data.phone, id: { not: userId }, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict("Another account already uses that phone number");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      // Changing the number means it has not been confirmed on this one yet.
      ...(data.phone !== undefined ? { phone: data.phone, phoneVerifiedAt: null } : {}),
      ...(data.locale !== undefined ? { locale: data.locale } : {}),
    },
  });

  return getCustomer(userId);
}

async function assertCustomer(userId) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, isSuperAdmin: true, roleAssignments: { select: { role: { select: { key: true } } } } },
  });
  if (!user) throw ApiError.notFound("Customer not found");
  if (!user.roleAssignments.some((assignment) => assignment.role.key === CUSTOMER_ROLE_KEY)) {
    throw ApiError.notFound("Customer not found");
  }
  // A staff account that also shops here is still a staff account: suspending
  // or deleting it belongs on the Users screen, with the role checks that guard
  // who may act on whom.
  if (user.isSuperAdmin || user.roleAssignments.some((assignment) => !["customer", "creator"].includes(assignment.role.key))) {
    throw ApiError.conflict("This person is a staff member. Manage their account from Users.");
  }
  return user;
}

/** Rows a CSV export writes, in order. */
export const EXPORT_COLUMNS = ["id", "kind", "name", "email", "phone", "status", "orders", "spend", "lastOrderAt", "joinedAt"];

export async function exportCustomers({ scope = null, search = null, kind = null } = {}) {
  const { items } = await listCustomers({ scope, search, kind, limit: 10_000, offset: 0 });
  return items.map((row) => ({
    id: row.id,
    kind: row.kind === "GUEST" ? "Guest" : "Account",
    name: row.name,
    email: row.email ?? "",
    phone: row.phone ?? "",
    status: row.status ?? "",
    orders: String(row.orders),
    spend: row.spend.toFixed(2),
    lastOrderAt: row.lastOrderAt ? row.lastOrderAt.toISOString() : "",
    joinedAt: row.joinedAt ? new Date(row.joinedAt).toISOString() : "",
  }));
}

export { assertCustomer };
