import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess, cursorArgs, toPage } from "@/lib/api";
import { shortCode } from "@/server/utils/crypto";
import { env } from "@/lib/env";
import { getBranchMenu } from "@/server/services/menu.service";

/**
 * Printable QR codes and what happens when one is scanned.
 *
 * The governing constraint is physical: **a printed sticker cannot be changed.**
 * Once a code is on a table it may be scanned for years, so the token in it is
 * opaque and permanent, and everything about where it leads lives in the row.
 * Repointing a code — a new menu, a renamed table, a seasonal promotion — is an
 * edit here, never a reprint.
 *
 * Three consequences run through this module:
 *   * the encoded URL is `{APP_URL}/m/{code}` and never contains a menu or
 *     product id, so nothing in it can go stale
 *   * a target that disappears nulls the reference rather than cascading, so
 *     the sticker survives to be repointed (see the migration)
 *   * resolution happens at scan time against the branch's live schedule, so a
 *     table code shows lunch at noon and dinner at eight with no intervention
 */

/** How the code is printed and what a scanner opens. */
export function qrUrl(code) {
  return `${env().APP_URL.replace(/\/$/, "")}/m/${code}`;
}

const SELECT = {
  id: true,
  code: true,
  branchId: true,
  targetType: true,
  menuId: true,
  tableId: true,
  categoryId: true,
  productId: true,
  customUrl: true,
  label: true,
  imageUrl: true,
  isActive: true,
  scanCount: true,
  lastScannedAt: true,
  printedAt: true,
  createdAt: true,
  updatedAt: true,
};

const WITH_TARGETS = {
  ...SELECT,
  branch: { select: { id: true, code: true, name: true, timezone: true } },
  menu: { select: { id: true, name: true, slug: true, type: true } },
  table: { select: { id: true, name: true, area: true } },
  // `isActive` / `deletedAt` come along so a scan can tell whether the target
  // is still something a customer may be shown.
  category: { select: { id: true, name: true, slug: true, isActive: true } },
  product: { select: { id: true, name: true, slug: true, isActive: true, deletedAt: true } },
};

function shape(row) {
  return { ...row, url: qrUrl(row.code) };
}

/** QR id in, branch permission check done, branch id out. */
export async function assertQrAccess(principal, qrCodeId, permissionKey) {
  const qr = await prisma.qrCode.findUnique({ where: { id: qrCodeId }, select: { branchId: true } });
  if (!qr) throw ApiError.notFound("QR code not found");

  assertBranchAccess(principal, qr.branchId, permissionKey);
  return qr.branchId;
}

/**
 * A free short code.
 *
 * Retried rather than trusted: 32^8 is a huge space, but the unique index is
 * what actually guarantees correctness and a collision must not surface as a
 * 500 on someone printing stickers.
 */
async function allocateCode(attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = shortCode(8);
    const clash = await prisma.qrCode.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }

  throw ApiError.internal("Could not allocate a unique QR code, please retry");
}

/**
 * Checks that the target matches the declared type and belongs to the branch.
 *
 * Cross-branch targets are the failure that matters here: a code printed for
 * the Lahore branch must not be repointable at Karachi's menu, or a scan in one
 * dining room shows another restaurant's prices.
 */
async function resolveTarget({ branchId, targetType, menuId, tableId, categoryId, productId, customUrl }) {
  const target = { menuId: null, tableId: null, categoryId: null, productId: null, customUrl: null };

  switch (targetType) {
    case "MENU": {
      // A MENU code may pin one menu, or leave it open and follow whatever the
      // branch has scheduled — which is what most codes want.
      if (menuId) {
        const menu = await prisma.menu.findFirst({ where: { id: menuId, branchId }, select: { id: true } });
        if (!menu) {
          throw ApiError.validation("That menu does not belong to this branch", {
            menuId: ["Pick a menu of the same branch"],
          });
        }
        target.menuId = menuId;
      }
      return target;
    }

    case "TABLE": {
      if (!tableId) throw ApiError.validation("A table code needs a table", { tableId: ["Required"] });

      const table = await prisma.restaurantTable.findFirst({
        where: { id: tableId, branchId },
        select: { id: true },
      });
      if (!table) {
        throw ApiError.validation("That table does not belong to this branch", {
          tableId: ["Pick a table of the same branch"],
        });
      }
      target.tableId = tableId;

      // A table code may also pin a menu (a bar table showing the drinks menu).
      if (menuId) {
        const menu = await prisma.menu.findFirst({ where: { id: menuId, branchId }, select: { id: true } });
        if (!menu) {
          throw ApiError.validation("That menu does not belong to this branch", {
            menuId: ["Pick a menu of the same branch"],
          });
        }
        target.menuId = menuId;
      }
      return target;
    }

    case "CATEGORY": {
      if (!categoryId) throw ApiError.validation("A category code needs a category", { categoryId: ["Required"] });

      const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
      if (!category) throw ApiError.validation("Category not found", { categoryId: ["No such category"] });

      // Categories and products are global, so there is no branch to check.
      target.categoryId = categoryId;
      return target;
    }

    case "PRODUCT": {
      if (!productId) throw ApiError.validation("A product code needs a product", { productId: ["Required"] });

      const product = await prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw ApiError.validation("Product not found", { productId: ["No such product"] });

      target.productId = productId;
      return target;
    }

    case "CUSTOM_URL": {
      if (!customUrl) throw ApiError.validation("A custom code needs a URL", { customUrl: ["Required"] });
      target.customUrl = customUrl;
      return target;
    }

    default:
      throw ApiError.validation("Unknown QR target type", { targetType: ["Not a supported target"] });
  }
}

// --- CRUD -------------------------------------------------------------------

export async function listQrCodes({ branchId, targetType, tableId, isActive, limit = 50, cursor } = {}) {
  const rows = await prisma.qrCode.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(tableId ? { tableId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
    select: WITH_TARGETS,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(shape) };
}

export async function getQrCode(id) {
  const qr = await prisma.qrCode.findUnique({ where: { id }, select: WITH_TARGETS });
  if (!qr) throw ApiError.notFound("QR code not found");

  return shape(qr);
}

export async function createQrCode(data, actor) {
  const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  const target = await resolveTarget(data);
  const code = await allocateCode();

  const qr = await prisma.qrCode.create({
    data: {
      code,
      branchId: data.branchId,
      targetType: data.targetType,
      label: data.label ?? null,
      isActive: data.isActive ?? true,
      createdById: actor?.userId ?? null,
      ...target,
    },
    select: { id: true },
  });

  return getQrCode(qr.id);
}

/**
 * Repointing.
 *
 * The `code` is deliberately not editable: it is printed on physical objects.
 * Everything else is, which is the whole point of the indirection.
 */
export async function updateQrCode(id, data) {
  const existing = await prisma.qrCode.findUnique({
    where: { id },
    select: {
      id: true,
      branchId: true,
      targetType: true,
      menuId: true,
      tableId: true,
      categoryId: true,
      productId: true,
      customUrl: true,
    },
  });
  if (!existing) throw ApiError.notFound("QR code not found");

  // Merge before validating: a PATCH that changes only `targetType` has to be
  // checked against the ids already on the row, and one that changes only the
  // id against the type already stored.
  const merged = { ...existing, ...data };
  const target = await resolveTarget({ ...merged, branchId: existing.branchId });

  await prisma.qrCode.update({
    where: { id },
    data: {
      targetType: merged.targetType,
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...target,
    },
  });

  return getQrCode(id);
}

export async function deleteQrCode(id) {
  const qr = await prisma.qrCode.findUnique({ where: { id }, select: { id: true, printedAt: true } });
  if (!qr) throw ApiError.notFound("QR code not found");

  // Scans cascade with the code, so its history goes too — that is why a
  // printed code should be deactivated rather than deleted.
  await prisma.qrCode.delete({ where: { id } });
  return { deleted: true, id };
}

// --- printable asset --------------------------------------------------------

const RENDER = {
  svg: { type: "svg", contentType: "image/svg+xml" },
  png: { type: "png", contentType: "image/png" },
};

/**
 * Renders the printable code.
 *
 * SVG by default: a QR sticker is printed, and vector output stays sharp at any
 * size where a fixed-resolution PNG does not. Error correction is set to `M`
 * (~15% recoverable) — high enough to survive a scuffed sticker on a table,
 * without inflating the module count so far that the printed code becomes dense
 * and hard to scan at small sizes.
 *
 * The quiet zone matters more than it looks: `margin: 2` modules is the minimum
 * many scanners need to find the code at all, so a caller cannot set it to 0.
 */
export async function renderQrAsset({ id, format = "svg", size = 512, markPrinted = false }) {
  const qr = await prisma.qrCode.findUnique({ where: { id }, select: { id: true, code: true, isActive: true } });
  if (!qr) throw ApiError.notFound("QR code not found");

  const render = RENDER[format];
  if (!render) throw ApiError.validation("Unsupported format", { format: ["Use svg or png"] });

  const options = { errorCorrectionLevel: "M", margin: 2, width: size };
  const url = qrUrl(qr.code);

  const body =
    format === "svg"
      ? Buffer.from(await QRCode.toString(url, { ...options, type: "svg" }), "utf8")
      : await QRCode.toBuffer(url, { ...options, type: "png" });

  if (markPrinted) {
    await prisma.qrCode.update({ where: { id }, data: { printedAt: new Date() } });
  }

  return { body, contentType: render.contentType, filename: `qr-${qr.code}.${format}`, url, code: qr.code };
}

// --- scanning ---------------------------------------------------------------

/**
 * What a scan resolves to, and the record that it happened.
 *
 * Reads deliberately have a side effect here, which is unusual enough to
 * justify: a QR scan *is* a GET — the camera opens a URL and nothing else ever
 * happens — so counting it anywhere else would mean counting nothing. The write
 * is kept off the response path by the caller (`after()`), so a slow insert
 * never delays a hungry customer's menu.
 *
 * An inactive code and a missing code both return 404. Telling a scanner that a
 * code exists but is switched off is information it cannot use, and it lets
 * someone enumerate valid codes.
 */
export async function resolveQrTarget(code, { at = new Date(), includeUnavailable = false } = {}) {
  const qr = await prisma.qrCode.findUnique({ where: { code }, select: WITH_TARGETS });
  if (!qr || !qr.isActive) throw ApiError.notFound("This QR code is not valid");

  const branch = await prisma.branch.findUnique({
    where: { id: qr.branchId },
    select: { id: true, code: true, name: true, timezone: true, currency: true, isActive: true },
  });
  if (!branch?.isActive) throw ApiError.notFound("This QR code is not valid");

  const base = {
    qrCodeId: qr.id,
    code: qr.code,
    targetType: qr.targetType,
    label: qr.label,
    branch: { id: branch.id, code: branch.code, name: branch.name, timezone: branch.timezone, currency: branch.currency },
    table: qr.table,
  };

  if (qr.targetType === "CUSTOM_URL") return { ...base, redirectUrl: qr.customUrl };

  /**
   * A category or product target can go stale underneath a printed sticker.
   *
   * The foreign key nulls itself only on a *hard* delete, and products are
   * deleted softly so that order history keeps its pricing context — so the id
   * survives, pointing at something a customer must not be shown. Unpublishing
   * does the same thing without any delete at all.
   *
   * Falling back to the branch's menu is the kind thing to do: someone is
   * standing at a table holding a phone, and an error page helps nobody. The
   * flag tells the client to say "that item has moved on" above the menu, and
   * tells staff the sticker needs repointing.
   */
  if (qr.targetType === "CATEGORY" || qr.targetType === "PRODUCT") {
    const target = qr.targetType === "CATEGORY" ? qr.category : qr.product;
    const live = target?.isActive && !target?.deletedAt;

    if (live) {
      return qr.targetType === "CATEGORY" ? { ...base, category: target } : { ...base, product: target };
    }

    const fallback = await getBranchMenu({ branchIdOrCode: branch.id, type: "DINE_IN", at, includeUnavailable });
    return { ...base, targetUnavailable: true, [qr.targetType.toLowerCase()]: null, ...fallback };
  }

  // MENU and TABLE both land on a menu. A pinned menu wins; otherwise the
  // branch's schedule decides, so one sticker serves breakfast and dinner.
  const menu = await getBranchMenu({
    branchIdOrCode: branch.id,
    // A table code shows the dine-in menu unless a specific menu was pinned.
    type: qr.menuId ? null : "QR",
    menuSlug: qr.menu?.slug ?? null,
    at,
    includeUnavailable,
  });

  // Fall back to the dine-in menu when no QR-specific menu is configured:
  // most restaurants publish one menu and expect the sticker to find it.
  if (!qr.menuId && !menu.menu) {
    const dineIn = await getBranchMenu({ branchIdOrCode: branch.id, type: "DINE_IN", at, includeUnavailable });
    if (dineIn.menu) return { ...base, ...dineIn };
  }

  return { ...base, ...menu };
}

/**
 * Records a scan. Called after the response is sent.
 *
 * Every scan is stored; de-duplication is left to the analytics query, because
 * "how many times was this scanned" and "how many people scanned it" are both
 * real questions and only the raw rows can answer both.
 */
export async function recordScan({ qrCodeId, sessionId, userId, ipAddress, userAgent }) {
  await prisma.$transaction([
    prisma.qrScan.create({
      data: {
        qrCodeId,
        sessionId: sessionId ?? null,
        userId: userId ?? null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
    }),
    prisma.qrCode.update({
      where: { id: qrCodeId },
      data: { scanCount: { increment: 1 }, lastScannedAt: new Date() },
    }),
  ]);
}

// --- analytics --------------------------------------------------------------

/**
 * Scan analytics for one code.
 *
 * `uniqueSessions` is the closer proxy for people: one diner scanning three
 * times while deciding is one customer, and the anonymous session id is what
 * separates that from three diners without requiring anyone to log in.
 */
export async function qrAnalytics({ qrCodeId, from, to }) {
  const qr = await prisma.qrCode.findUnique({
    where: { id: qrCodeId },
    select: { id: true, code: true, label: true, scanCount: true, lastScannedAt: true, createdAt: true },
  });
  if (!qr) throw ApiError.notFound("QR code not found");

  const window = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
  const where = { qrCodeId, ...(from || to ? { scannedAt: window } : {}) };
  // The raw query below binds these directly, and Prisma rejects `undefined`
  // in a parameter position — an absent bound is an explicit NULL.
  const fromParam = from ?? null;
  const toParam = to ?? null;

  const [total, sessions, byDay, recent] = await Promise.all([
    prisma.qrScan.count({ where }),
    prisma.qrScan.findMany({ where: { ...where, sessionId: { not: null } }, distinct: ["sessionId"], select: { sessionId: true } }),
    // Grouped in SQL rather than pulled into memory: a busy code accumulates
    // tens of thousands of scans and the chart only needs one row per day.
    prisma.$queryRaw`
      SELECT date_trunc('day', "scannedAt")::date AS day, count(*)::int AS scans
      FROM "QrScan"
      WHERE "qrCodeId" = ${qrCodeId}
        AND (${fromParam}::timestamptz IS NULL OR "scannedAt" >= ${fromParam}::timestamptz)
        AND (${toParam}::timestamptz IS NULL OR "scannedAt" <= ${toParam}::timestamptz)
      GROUP BY 1 ORDER BY 1 ASC
    `,
    prisma.qrScan.findMany({
      where,
      select: { id: true, sessionId: true, userId: true, scannedAt: true },
      orderBy: { scannedAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    qrCode: { ...qr, url: qrUrl(qr.code) },
    totalScans: total,
    uniqueSessions: sessions.length,
    byDay: byDay.map((row) => ({ day: row.day, scans: row.scans })),
    recentScans: recent,
  };
}

/** Which codes at a branch are actually being used. */
export async function branchQrAnalytics({ branchId, from, to, limit = 20 }) {
  const where = {
    qrCode: { branchId },
    ...(from || to ? { scannedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const [totalScans, grouped, codes] = await Promise.all([
    prisma.qrScan.count({ where }),
    prisma.qrScan.groupBy({
      by: ["qrCodeId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { qrCodeId: "desc" } },
      take: limit,
    }),
    prisma.qrCode.findMany({
      where: { branchId },
      select: { id: true, code: true, label: true, targetType: true, table: { select: { id: true, name: true } } },
    }),
  ]);

  const byId = new Map(codes.map((row) => [row.id, row]));

  return {
    branchId,
    totalScans,
    codeCount: codes.length,
    // A code with no scans at all never appears in `grouped`, so surface it
    // explicitly — "which posters is nobody scanning" is the useful question.
    topCodes: grouped.map((row) => ({ ...byId.get(row.qrCodeId), scans: row._count._all })),
    neverScanned: codes
      .filter((row) => !grouped.some((entry) => entry.qrCodeId === row.id))
      .slice(0, limit)
      .map((row) => ({ ...row, scans: 0 })),
  };
}

/**
 * Scan retention.
 *
 * `QrScan` is append-only and grows with every customer who looks at a menu, so
 * it is the fastest-growing table in the system by row count. The aggregate
 * that matters long-term (`QrCode.scanCount`) is a counter that never expires,
 * so old rows can be dropped without losing the headline number — only the
 * per-day detail, which nobody reads a year later.
 */
export async function pruneQrScans({ retentionDays = 180, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.qrScan.deleteMany({ where: { scannedAt: { lt: cutoff } } });
  return result.count;
}
