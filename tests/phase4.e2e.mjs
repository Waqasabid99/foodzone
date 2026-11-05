import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 4 — Dine-in surface (tables, QR codes, the public scan), end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 npx next dev -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e4-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E4${String(stamp).slice(-5)}`;
const OTHER_CODE = `E2E4X${String(stamp).slice(-4)}`;
const created = { userIds: new Set(), branchIds: new Set() };

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail !== undefined ? "::" + JSON.stringify(detail).slice(0, 300) : "");
  }
}

let ipCounter = 0;
const nextIp = () => `10.40.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip, rawResponse } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (rawResponse) {
    return { status: res.status, headers: res.headers, text: await res.text() };
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json, headers: res.headers };
}

/** The outbox/after() write is asynchronous; give it a moment to land. */
async function waitFor(predicate, { timeoutMs = 6000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main() {
  // ---- actors -------------------------------------------------------------
  const cust = await api("/auth/register", {
    method: "POST",
    body: { name: "P4 Customer", email: emailOf("cust"), password: "customer-passphrase" },
  });
  created.userIds.add(cust.body.data.user.id);
  const custToken = cust.body.data.accessToken;

  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P4 Admin", email: emailOf("admin"), password: "admin-passphrase-4" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-4" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P4 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  // A second branch, to prove codes and tables cannot cross between them.
  const other = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: OTHER_CODE, name: "P4 Other", city: "Lahore", timezone: "Asia/Karachi" },
  });
  const otherBranchId = other.body.data.id;
  created.branchIds.add(otherBranchId);
  check("two test branches exist", branch.status === 201 && other.status === 201, { a: branch.body, b: other.body });

  // ===================== TABLES =====================
  const denied = await api("/admin/tables", {
    method: "POST",
    token: custToken,
    body: { branchId, name: "T-1" },
  });
  check("a customer cannot create a table", denied.status === 403, denied.body?.error);

  const table = await api("/admin/tables", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "T-1", area: "Terrace", seats: 6 },
  });
  check("a table is created", table.status === 201 && table.body.data.seats === 6, table.body);
  const tableId = table.body.data.id;

  const dupe = await api("/admin/tables", { method: "POST", token: adminToken, body: { branchId, name: "t-1" } });
  check("table names are unique per branch, case-insensitively", dupe.status === 409, dupe.body?.error);

  const sameNameElsewhere = await api("/admin/tables", {
    method: "POST",
    token: adminToken,
    body: { branchId: otherBranchId, name: "T-1" },
  });
  check("the same table name is fine at another branch", sameNameElsewhere.status === 201, sameNameElsewhere.body);
  const otherTableId = sameNameElsewhere.body.data.id;

  const badBranch = await api("/admin/tables", {
    method: "POST",
    token: adminToken,
    body: { branchId: "no-such-branch", name: "T-99" },
  });
  check("an unknown branch is rejected", badBranch.status === 400 || badBranch.status === 403, badBranch.body?.error);

  const bulk = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId, prefix: "B-", from: 1, to: 5, seats: 2, area: "Bar", padTo: 2 },
  });
  check("tables can be created in bulk", bulk.status === 201 && bulk.body.data.created === 5, bulk.body?.data);
  check("bulk names are zero-padded when asked", bulk.body?.data?.tables?.[0]?.name === "B-01", bulk.body?.data?.tables?.[0]);

  const bulkAgain = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId, prefix: "B-", from: 1, to: 7, seats: 2, padTo: 2 },
  });
  check("re-running bulk adds only the new tables", bulkAgain.body?.data?.created === 2 && bulkAgain.body?.data?.skipped === 5, bulkAgain.body?.data);

  const bulkAllExisting = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId, prefix: "B-", from: 1, to: 3, padTo: 2 },
  });
  check("a bulk range that is entirely taken is 409", bulkAllExisting.status === 409, bulkAllExisting.body?.error);

  const hugeRange = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId, prefix: "X-", from: 1, to: 5000 },
  });
  check("an implausibly large bulk range is refused", hugeRange.status === 400, hugeRange.body?.error);

  const backwards = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId, prefix: "Y-", from: 10, to: 2 },
  });
  check("a backwards bulk range is refused", backwards.status === 400, backwards.body?.error);

  const listed = await api(`/admin/tables?branchId=${branchId}&limit=200`, { token: adminToken });
  check("tables list for the branch", listed.status === 200 && listed.body.data.length === 8, listed.body?.data?.length);

  const byArea = await api(`/admin/tables?branchId=${branchId}&area=Bar&limit=200`, { token: adminToken });
  check("tables filter by area", byArea.body?.data?.length === 5 && byArea.body.data.every((t) => t.area === "Bar"), byArea.body?.data?.length);

  const areas = await api(`/admin/tables/areas?branchId=${branchId}`, { token: adminToken });
  check("the distinct area list is available", Array.isArray(areas.body?.data) && areas.body.data.includes("Bar") && areas.body.data.includes("Terrace"), areas.body?.data);

  const renamed = await api(`/admin/tables/${tableId}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: "T-01", seats: 8 },
  });
  check("a table can be renamed", renamed.status === 200 && renamed.body.data.name === "T-01", renamed.body);

  const renameClash = await api(`/admin/tables/${tableId}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: "B-01" },
  });
  check("renaming onto an existing name is 409", renameClash.status === 409, renameClash.body?.error);

  // ===================== QR CODES =====================
  const qrDenied = await api("/admin/qr-codes", {
    method: "POST",
    token: custToken,
    body: { branchId, targetType: "MENU" },
  });
  check("a customer cannot create a QR code", qrDenied.status === 403, qrDenied.body?.error);

  const menuQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "MENU", label: "Window poster" },
  });
  check("a menu QR code is created", menuQr.status === 201, menuQr.body);
  check("the code is a short opaque token", /^[0-9A-HJKMNP-TV-Z]{8}$/.test(menuQr.body?.data?.code ?? ""), menuQr.body?.data?.code);
  check("the printable URL is returned with it", menuQr.body?.data?.url?.endsWith(`/m/${menuQr.body.data.code}`), menuQr.body?.data?.url);
  const menuQrId = menuQr.body.data.id;
  const menuQrCode = menuQr.body.data.code;

  const secondQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "MENU", label: "Second poster" },
  });
  check("each code is distinct", secondQr.body?.data?.code !== menuQrCode, secondQr.body?.data?.code);
  const unusedQrId = secondQr.body.data.id;

  const tableQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "TABLE", tableId, label: "Table 1 stand" },
  });
  check("a table QR code is created", tableQr.status === 201 && tableQr.body.data.table.id === tableId, tableQr.body);
  const tableQrCode = tableQr.body.data.code;

  const tableless = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "TABLE" },
  });
  check("a table code without a table is rejected", tableless.status === 400, tableless.body?.error);

  const crossBranchTable = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "TABLE", tableId: otherTableId },
  });
  check("a code cannot point at another branch's table", crossBranchTable.status === 400, crossBranchTable.body?.error);

  const badUrl = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "CUSTOM_URL", customUrl: "javascript:alert(1)" },
  });
  check("a non-http custom URL is refused", badUrl.status === 400, badUrl.body?.error);

  const customQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "CUSTOM_URL", customUrl: "https://example.test/feedback", label: "Feedback" },
  });
  check("a custom-URL code is created", customQr.status === 201, customQr.body);
  const customQrCode = customQr.body.data.code;

  // --- category and product targets (the columns added this phase) ---------
  const category = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Desserts ${stamp}` },
  });
  const categoryId = category.body.data.id;

  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Kulfi ${stamp}`, categoryId, price: 300 },
  });
  const productId = product.body.data.id;
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const categoryQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "CATEGORY", categoryId, label: "Dessert stand" },
  });
  check("a category QR code is created", categoryQr.status === 201 && categoryQr.body.data.category.id === categoryId, categoryQr.body);
  const categoryQrCode = categoryQr.body.data.code;

  const productQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "PRODUCT", productId },
  });
  check("a product QR code is created", productQr.status === 201 && productQr.body.data.product.id === productId, productQr.body);
  const productQrCode = productQr.body.data.code;

  const categoryless = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId, targetType: "CATEGORY" },
  });
  check("a category code without a category is rejected", categoryless.status === 400, categoryless.body?.error);

  // ===================== MENUS FOR THE SCAN =====================
  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, isActive: true, name: `Dine in ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  const menuId = menu.body.data.id;
  await api(`/admin/menus/${menuId}/items`, { method: "POST", token: adminToken, body: { productId } });

  const crossBranchMenu = await api(`/admin/qr-codes/${menuQrId}`, {
    method: "PATCH",
    token: adminToken,
    body: { targetType: "MENU", menuId },
  });
  check("a code can be pinned to a menu of its own branch", crossBranchMenu.status === 200, crossBranchMenu.body?.error);

  const otherMenu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId: otherBranchId, isActive: true, name: `Other menu ${stamp}`, type: "DINE_IN" },
  });
  const otherMenuId = otherMenu.body.data.id;

  const stealMenu = await api(`/admin/qr-codes/${menuQrId}`, {
    method: "PATCH",
    token: adminToken,
    body: { menuId: otherMenuId },
  });
  check("a code cannot be repointed at another branch's menu", stealMenu.status === 400, stealMenu.body?.error);

  const menuWithQr = await api(`/admin/menus/${menuId}`, { method: "DELETE", token: adminToken });
  check("a menu with QR codes pointing at it cannot be deleted", menuWithQr.status === 409, menuWithQr.body?.error);

  // Unpin so the scan follows the branch's schedule instead.
  const unpinned = await api(`/admin/qr-codes/${menuQrId}`, {
    method: "PATCH",
    token: adminToken,
    body: { targetType: "MENU", menuId: null },
  });
  check("a code can be unpinned back to the branch's schedule", unpinned.status === 200 && unpinned.body.data.menuId === null, unpinned.body?.data);

  // ===================== PRINTABLE ASSET =====================
  const svg = await api(`/admin/qr-codes/${menuQrId}/image`, { token: adminToken, rawResponse: true });
  check("the printable asset renders as SVG by default", svg.status === 200 && svg.headers.get("content-type") === "image/svg+xml", svg.status);
  check("the SVG is a real QR render", svg.text?.startsWith("<?xml") || svg.text?.includes("<svg"), svg.text?.slice(0, 60));
  check("the encoded URL is surfaced on the response", svg.headers.get("x-qr-url")?.endsWith(`/m/${menuQrCode}`), svg.headers.get("x-qr-url"));

  const png = await api(`/admin/qr-codes/${menuQrId}/image?format=png&size=256`, { token: adminToken, rawResponse: true });
  check("the asset can be rendered as PNG", png.status === 200 && png.headers.get("content-type") === "image/png", png.status);

  const badFormat = await api(`/admin/qr-codes/${menuQrId}/image?format=pdf`, { token: adminToken });
  check("an unsupported image format is rejected", badFormat.status === 400, badFormat.body?.error);

  const beforePrint = await api(`/admin/qr-codes/${menuQrId}`, { token: adminToken });
  check("a code starts unprinted", beforePrint.body?.data?.printedAt === null, beforePrint.body?.data?.printedAt);

  await api(`/admin/qr-codes/${menuQrId}/image?markPrinted=true`, { token: adminToken, rawResponse: true });
  const afterPrint = await api(`/admin/qr-codes/${menuQrId}`, { token: adminToken });
  check("downloading with markPrinted stamps printedAt", !!afterPrint.body?.data?.printedAt, afterPrint.body?.data?.printedAt);

  const custPrint = await api(`/admin/qr-codes/${menuQrId}/image`, { token: custToken });
  check("a customer cannot download the printable asset", custPrint.status === 403, custPrint.body?.error);

  // ===================== THE PUBLIC SCAN =====================
  const scan = await api(`/qr/${menuQrCode}?sessionId=${tag}-session-a`);
  check("a scan resolves without auth", scan.status === 200, scan.body?.error);
  check("the scan reports the branch", scan.body?.data?.branch?.id === branchId, scan.body?.data?.branch);
  check("the scan falls back to the dine-in menu", scan.body?.data?.menu?.id === menuId, scan.body?.data?.menu);
  check("the resolved menu carries its products", scan.body?.data?.sections?.[0]?.products?.length >= 1, scan.body?.data?.sections);

  const lowercase = await api(`/qr/${menuQrCode.toLowerCase()}`);
  check("codes are case-insensitive, as printed codes get typed by hand", lowercase.status === 200, lowercase.body?.error);

  const tableScan = await api(`/qr/${tableQrCode}?sessionId=${tag}-session-b`);
  check("a table scan names the table", tableScan.body?.data?.table?.name === "T-01", tableScan.body?.data?.table);
  check("a table scan still resolves a menu", !!tableScan.body?.data?.menu, tableScan.body?.data?.menu);

  const customScan = await api(`/qr/${customQrCode}`);
  check("a custom-URL scan returns the redirect target", customScan.body?.data?.redirectUrl === "https://example.test/feedback", customScan.body?.data);

  const categoryScan = await api(`/qr/${categoryQrCode}`);
  check("a category scan returns the category", categoryScan.body?.data?.category?.id === categoryId, categoryScan.body?.data);

  const productScan = await api(`/qr/${productQrCode}`);
  check("a product scan returns the product", productScan.body?.data?.product?.id === productId, productScan.body?.data);

  const unknown = await api("/qr/ZZZZZZZZ");
  check("an unknown code is 404", unknown.status === 404, unknown.body?.error);

  const malformed = await api("/qr/not-a-code!!");
  check("a malformed code is rejected before the database", malformed.status === 400 || malformed.status === 404, malformed.status);

  await api(`/admin/qr-codes/${menuQrId}`, { method: "PATCH", token: adminToken, body: { isActive: false } });
  const deactivated = await api(`/qr/${menuQrCode}`);
  check("a deactivated code is 404, not a distinguishable 'disabled'", deactivated.status === 404, deactivated.body?.error);
  await api(`/admin/qr-codes/${menuQrId}`, { method: "PATCH", token: adminToken, body: { isActive: true } });

  // ===================== SCAN TRACKING =====================
  const recorded = await waitFor(async () => (await prisma.qrScan.count({ where: { qrCodeId: menuQrId } })) >= 2);
  check("scans are recorded asynchronously", recorded, await prisma.qrScan.count({ where: { qrCodeId: menuQrId } }));

  const counted = await api(`/admin/qr-codes/${menuQrId}`, { token: adminToken });
  check("the code's scan counter advances", counted.body?.data?.scanCount >= 2, counted.body?.data?.scanCount);
  check("lastScannedAt is stamped", !!counted.body?.data?.lastScannedAt, counted.body?.data?.lastScannedAt);

  // Same session twice: total scans rise, unique sessions do not.
  await api(`/qr/${menuQrCode}?sessionId=${tag}-session-a`);
  await api(`/qr/${menuQrCode}?sessionId=${tag}-session-a`);
  await waitFor(async () => (await prisma.qrScan.count({ where: { qrCodeId: menuQrId } })) >= 4);

  const analytics = await api(`/admin/qr-codes/${menuQrId}/analytics`, { token: adminToken });
  check("per-code analytics are available", analytics.status === 200, analytics.body?.error);
  check("total scans counts every scan", analytics.body?.data?.totalScans >= 4, analytics.body?.data?.totalScans);
  check("unique sessions de-duplicates one diner scanning repeatedly", analytics.body?.data?.uniqueSessions === 1, analytics.body?.data);
  check("scans are bucketed by day for charting", Array.isArray(analytics.body?.data?.byDay) && analytics.body.data.byDay.length >= 1, analytics.body?.data?.byDay);
  check("recent scans are listed", analytics.body?.data?.recentScans?.length >= 1, analytics.body?.data?.recentScans?.length);

  const windowed = await api(
    `/admin/qr-codes/${menuQrId}/analytics?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`,
    { token: adminToken },
  );
  check("a future window reports no scans", windowed.body?.data?.totalScans === 0, windowed.body?.data?.totalScans);

  /*
   * The chart and the headline must agree about the same window.
   *
   * They are built by two different queries — `totalScans` through Prisma,
   * `byDay` through raw SQL so a busy code's tens of thousands of scans are
   * grouped in the database — and two queries over one window is exactly the
   * shape that drifts apart. `scannedAt` is `timestamp without time zone`
   * holding UTC while the raw query casts its bounds to `timestamptz`, so on a
   * non-UTC server Postgres reinterprets both the column and the bound in the
   * session's zone; the shifts cancel and the window holds. This asserts that
   * rather than trusting it, because the next person to read that SQL will
   * wonder, and because a one-sided version of the same comparison is a real
   * bug — it is what made the outbox claim events up to five hours early.
   *
   * An hour-wide window, not a day: a skew of a few hours hides inside a day.
   */
  const lastHour = await api(
    `/admin/qr-codes/${menuQrId}/analytics?from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`,
    { token: adminToken },
  );
  const charted = (lastHour.body?.data?.byDay ?? []).reduce((sum, row) => sum + Number(row.scans), 0);
  check(
    "the day chart agrees with the headline over the same window",
    charted === lastHour.body?.data?.totalScans && charted >= 4,
    { charted, totalScans: lastHour.body?.data?.totalScans, byDay: lastHour.body?.data?.byDay },
  );

  const branchAnalytics = await api(`/admin/qr-codes/analytics?branchId=${branchId}`, { token: adminToken });
  check("branch-level analytics are available", branchAnalytics.status === 200, branchAnalytics.body?.error);
  check("the busiest codes are ranked", branchAnalytics.body?.data?.topCodes?.[0]?.id === menuQrId, branchAnalytics.body?.data?.topCodes);
  check("codes nobody scans are surfaced", branchAnalytics.body?.data?.neverScanned?.some((c) => c.id === unusedQrId), branchAnalytics.body?.data?.neverScanned);

  const custAnalytics = await api(`/admin/qr-codes/${menuQrId}/analytics`, { token: custToken });
  check("a customer cannot read scan analytics", custAnalytics.status === 403, custAnalytics.body?.error);

  // ===================== DELETION BEHAVIOUR =====================
  const deleteTableWithQr = await api(`/admin/tables/${tableId}`, { method: "DELETE", token: adminToken });
  check("deleting a table succeeds", deleteTableWithQr.status === 200, deleteTableWithQr.body);
  check("and deactivates the QR codes pointing at it", deleteTableWithQr.body?.data?.qrCodesDeactivated === 1, deleteTableWithQr.body?.data);

  const orphanScan = await api(`/qr/${tableQrCode}`);
  check("a sticker for a deleted table stops resolving rather than misleading", orphanScan.status === 404, orphanScan.body?.error);

  // An unpublished product is already stale for a customer, without any delete.
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: false } });
  const unpublishedScan = await api(`/qr/${productQrCode}`);
  check("unpublishing a product makes its sticker fall back to the menu", unpublishedScan.status === 200 && unpublishedScan.body?.data?.targetUnavailable === true, unpublishedScan.body?.data);
  check("the stale product is not shown to the customer", unpublishedScan.body?.data?.product === null, unpublishedScan.body?.data?.product);
  check("the fallback still hands over a usable menu", !!unpublishedScan.body?.data?.menu, unpublishedScan.body?.data?.menu);

  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });
  const republished = await api(`/qr/${productQrCode}`);
  check("republishing restores the sticker's target", republished.body?.data?.product?.id === productId, republished.body?.data);

  // Products are deleted softly, so the foreign key never fires — the row keeps
  // pointing at a product the customer must not be shown.
  await api(`/admin/products/${productId}`, { method: "DELETE", token: adminToken });
  const survivingQr = await prisma.qrCode.findFirst({ where: { code: productQrCode }, select: { id: true, productId: true } });
  check("a deleted product leaves its QR code alive to be repointed", !!survivingQr, survivingQr);

  const deletedScan = await api(`/qr/${productQrCode}`);
  check("a sticker for a deleted product falls back rather than serving it", deletedScan.status === 200 && deletedScan.body?.data?.targetUnavailable === true, deletedScan.body?.data);
  check("the deleted product is not shown to the customer", deletedScan.body?.data?.product === null, deletedScan.body?.data?.product);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  // Scans cascade with their code; codes, tables and menus cascade with the
  // branch, but delete them explicitly so a failed run still tidies up.
  await prisma.qrCode.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.restaurantTable.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E4" } } });

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    tables: await prisma.restaurantTable.count(),
    qrCodes: await prisma.qrCode.count(),
    qrScans: await prisma.qrScan.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    menus: await prisma.menu.count(),
    roles: await prisma.role.count(),
  };
  console.log("\nDatabase after cleanup:", JSON.stringify(leftovers));
  return leftovers;
}

try {
  // Wake the database before the first assertion, so a suspended compute
  // fails here rather than as a mystery timeout mid-suite.
  await warmUpDatabase(prisma);
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.message, "\n", error.stack?.split("\n").slice(0, 5).join("\n"));
  failures.push("suite crashed: " + error.message);
} finally {
  const leftovers = await cleanup();
  await prisma.$disconnect();
  const clean =
    leftovers.users === 0 &&
    leftovers.branches === 0 &&
    leftovers.tables === 0 &&
    leftovers.qrCodes === 0 &&
    leftovers.qrScans === 0 &&
    leftovers.categories === 0 &&
    leftovers.products === 0 &&
    leftovers.menus === 0 &&
    leftovers.roles === 20;
  if (!clean) console.log("WARNING: database not back to baseline");
  process.exit(failures.length === 0 && clean ? 0 : 1);
}
