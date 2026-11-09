import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 9 — Inventory and procurement, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * Conversion and costing arithmetic is pinned in tests/unit.mjs. What this
 * suite proves is what only exists with a database: that the ledger and the
 * cached levels never disagree, that a receipt lands the true cost including
 * freight, that FIFO consumes real batches, that a count is blind and its
 * variance posts once, and that selling a dish deducts what it was made of.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e9-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E9${String(stamp).slice(-5)}`;
const created = { userIds: new Set(), branchIds: new Set(), unitIds: new Set() };

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
const nextIp = () => `10.90.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

/**
 * Drains the outbox **until it is empty**, not once.
 *
 * Selling a dish does not deduct its ingredients in the request that completes
 * the order — a job does it. The worker claims a bounded batch and handlers
 * enqueue more as they run, so a single cycle leaves the stock event sitting
 * in the queue and the deduction appears never to have happened. That is why
 * this suite failed only when run after the others: they left a backlog in
 * front of it.
 */
async function drainOutbox() {
  for (let cycle = 0; cycle < 40; cycle += 1) {
    const res = await fetch(`${BASE}/api/internal/jobs/outbox`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "phase2-test-secret"}` },
    });
    if (!res.ok) return;

    const body = await res.json().catch(() => null);
    if ((body?.data?.processed ?? 0) === 0 && (body?.data?.failed ?? 0) === 0) return;
  }
}

const num = (value) => Number(value ?? 0);
const round = (value, dp = 4) => Math.round(Number(value ?? 0) * 10 ** dp) / 10 ** dp;

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P9 Admin", email: emailOf("admin"), password: "admin-passphrase-9" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-9" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P9 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  // ================= UNITS =================
  const kgRes = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `KG${String(stamp).slice(-5)}`, name: "Kilogram", type: "WEIGHT", precision: 3 },
  });
  check("a base unit is created", kgRes.status === 201, kgRes.body);
  const kgId = kgRes.body.data.id;
  created.unitIds.add(kgId);

  const gRes = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `G${String(stamp).slice(-5)}`, name: "Gram", type: "WEIGHT", baseUnitId: kgId, factor: 0.001 },
  });
  check("a derived unit converts to its base", gRes.status === 201, gRes.body);
  const gId = gRes.body.data.id;
  created.unitIds.add(gId);

  const pcRes = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `PC${String(stamp).slice(-5)}`, name: "Piece", type: "COUNT", precision: 0 },
  });
  const pcId = pcRes.body.data.id;
  created.unitIds.add(pcId);

  const crossType = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `X${String(stamp).slice(-5)}`, name: "Bad", type: "VOLUME", baseUnitId: kgId, factor: 1 },
  });
  check("a unit cannot convert across measurement types", crossType.status === 400, crossType.body?.error);

  const chained = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `MG${String(stamp).slice(-5)}`, name: "Milligram", type: "WEIGHT", baseUnitId: gId, factor: 0.001 },
  });
  check("conversion chains are refused", chained.status === 400, chained.body?.error);

  // ================= ITEMS AND LOCATIONS =================
  const categoryRes = await api("/admin/inventory-categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Dry goods ${stamp}` },
  });
  const categoryId = categoryRes.body.data.id;

  const storeRes = await api("/admin/stock-locations", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Main store", code: "MAIN", type: "MAIN_STORE", isDefault: true },
  });
  check("a stock location is created", storeRes.status === 201, storeRes.body);
  const storeId = storeRes.body.data.id;

  const kitchenRes = await api("/admin/stock-locations", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Kitchen", code: "KIT", type: "KITCHEN" },
  });
  const kitchenId = kitchenRes.body.data.id;

  const dupCode = await api("/admin/stock-locations", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Another", code: "MAIN" },
  });
  check("location codes are unique per branch", dupCode.status === 409, dupCode.body?.error);

  const beefRes = await api("/admin/inventory-items", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Beef ${stamp}`,
      categoryId,
      uomId: kgId,
      type: "RAW_MATERIAL",
      costingMethod: "WEIGHTED_AVERAGE",
      isPerishable: true,
      trackBatches: true,
      shelfLifeDays: 5,
      reorderLevel: 5,
      reorderQuantity: 20,
      yieldPercent: 80,
    },
  });
  check("an inventory item is created", beefRes.status === 201, beefRes.body);
  const beefId = beefRes.body.data.id;
  check("a SKU is generated when none is given", Boolean(beefRes.body.data.sku), beefRes.body?.data);

  const bunRes = await api("/admin/inventory-items", {
    method: "POST",
    token: adminToken,
    body: { name: `Bun ${stamp}`, categoryId, uomId: pcId, costingMethod: "FIFO", trackBatches: true },
  });
  const bunId = bunRes.body.data.id;

  const badPerishable = await api("/admin/inventory-items", {
    method: "POST",
    token: adminToken,
    body: { name: `Milk ${stamp}`, uomId: kgId, isPerishable: true },
  });
  check("a perishable needs a shelf life or batch tracking", badPerishable.status === 400, badPerishable.body?.error);

  // ================= SUPPLIER AND PURCHASE ORDER =================
  const supplierRes = await api("/admin/suppliers", {
    method: "POST",
    token: adminToken,
    body: { code: `SUP${String(stamp).slice(-6)}`, name: `Meat Co ${stamp}`, paymentTermDays: 30 },
  });
  check("a supplier is created", supplierRes.status === 201, supplierRes.body);
  const supplierId = supplierRes.body.data.id;

  const priceRes = await api(`/admin/suppliers/${supplierId}/items`, {
    method: "PUT",
    token: adminToken,
    body: { itemId: beefId, unitPrice: 1000, uomId: kgId, isPreferred: true, leadTimeDays: 2 },
  });
  check("a price list line is set", priceRes.status === 200, priceRes.body);

  const poRes = await api("/admin/purchase-orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      supplierId,
      shippingCost: 500,
      items: [{ itemId: beefId, quantity: 10 }, { itemId: bunId, quantity: 100, unitPrice: 20, uomId: pcId }],
    },
  });
  check("a purchase order is created", poRes.status === 201, poRes.body);
  const poId = poRes.body.data.id;
  check("lines price from the supplier's list when no price is given", num(poRes.body.data.items.find((l) => l.itemId === beefId).unitPrice) === 1000, poRes.body?.data?.items);
  // 10 x 1000 + 100 x 20 = 12000, plus 500 shipping.
  check("totals are derived server-side", num(poRes.body.data.grandTotal) === 12500, poRes.body?.data);

  const noStockYet = await api(`/admin/stock/levels?branchId=${branchId}`, { token: adminToken });
  check("ordering does not create stock", noStockYet.body.data.items.length === 0, noStockYet.body?.data);

  const receiveUnapproved = await api("/admin/goods-receipts", {
    method: "POST",
    token: adminToken,
    body: {
      locationId: storeId,
      supplierId,
      purchaseOrderId: poId,
      items: [{ itemId: beefId, quantity: 1, unitCost: 1000 }],
    },
  });
  check("goods cannot be received against an unapproved order", receiveUnapproved.status === 409, receiveUnapproved.body?.error);

  await api(`/admin/purchase-orders/${poId}/approve`, { method: "POST", token: adminToken });
  const sent = await api(`/admin/purchase-orders/${poId}/send`, { method: "POST", token: adminToken });
  check("an approved order can be sent", sent.body?.data?.status === "SENT", sent.body);

  const editSent = await api(`/admin/purchase-orders/${poId}`, {
    method: "PATCH",
    token: adminToken,
    body: { notes: "sneaky change" },
  });
  check("a sent order cannot be edited", editSent.status === 409, editSent.body?.error);

  // ================= GOODS RECEIPT =================
  const poDetail = await api(`/admin/purchase-orders/${poId}`, { token: adminToken });
  const beefLine = poDetail.body.data.items.find((l) => l.itemId === beefId);
  const bunLine = poDetail.body.data.items.find((l) => l.itemId === bunId);

  const overReceive = await api("/admin/goods-receipts", {
    method: "POST",
    token: adminToken,
    body: {
      locationId: storeId,
      supplierId,
      purchaseOrderId: poId,
      items: [{ itemId: beefId, purchaseOrderItemId: beefLine.id, quantity: 999, unitCost: 1000 }],
    },
  });
  check("more cannot be received than was ordered", overReceive.status === 400, overReceive.body?.error);

  const grnRes = await api("/admin/goods-receipts", {
    method: "POST",
    token: adminToken,
    body: {
      locationId: storeId,
      supplierId,
      purchaseOrderId: poId,
      supplierInvoiceNumber: `INV-${stamp}`,
      landedCost: 200,
      items: [
        {
          itemId: beefId,
          purchaseOrderItemId: beefLine.id,
          quantity: 10,
          rejectedQuantity: 2,
          unitCost: 1000,
          batchNumber: `B-${stamp}`,
        },
        { itemId: bunId, purchaseOrderItemId: bunLine.id, quantity: 100, unitCost: 20, uomId: pcId },
      ],
    },
  });
  check("a goods receipt is created", grnRes.status === 201, grnRes.body);
  const grnId = grnRes.body.data.id;

  const beforePost = await api(`/admin/stock/levels?branchId=${branchId}`, { token: adminToken });
  check("a draft receipt moves no stock", beforePost.body.data.items.length === 0, beforePost.body?.data);

  const posted = await api(`/admin/goods-receipts/${grnId}/post`, { method: "POST", token: adminToken });
  check("posting the receipt succeeds", posted.body?.data?.status === "COMPLETED", posted.body);

  const levels = await api(`/admin/stock/levels?branchId=${branchId}`, { token: adminToken });
  const beefLevel = levels.body.data.items.find((l) => l.itemId === beefId);
  const bunLevel = levels.body.data.items.find((l) => l.itemId === bunId);
  check("accepted stock is on hand", num(beefLevel.quantity) === 8, beefLevel);
  check("rejected stock never enters", num(beefLevel.quantity) !== 10, beefLevel);
  check("the second line is on hand too", num(bunLevel.quantity) === 100, bunLevel);

  const beefItem = await api(`/admin/inventory-items/${beefId}`, { token: adminToken });
  // 8 accepted at 1000 = 8000; freight 200 split by value (8000 of 10000) = 160.
  // (8000 + 160) / 8 = 1020.
  check("freight is landed into the unit cost", round(beefItem.body.data.averageCost) === 1020, beefItem.body?.data);

  const batches = await api(`/admin/stock-batches?itemId=${beefId}`, { token: adminToken });
  check("a batch is created for a tracked item", batches.body.data.items.length === 1, batches.body?.data);
  check("the batch carries the landed cost", round(batches.body.data.items[0].unitCost) === 1020, batches.body?.data?.items?.[0]);
  check("and an expiry from the shelf life", Boolean(batches.body.data.items[0].expiryDate), batches.body?.data?.items?.[0]);

  const poAfter = await api(`/admin/purchase-orders/${poId}`, { token: adminToken });
  check("the order records what was received", num(poAfter.body.data.items.find((l) => l.itemId === bunId).receivedQuantity) === 100, poAfter.body?.data?.items);

  const repost = await api(`/admin/goods-receipts/${grnId}/post`, { method: "POST", token: adminToken });
  const levelsAfterRepost = await api(`/admin/stock/levels?branchId=${branchId}`, { token: adminToken });
  check(
    "posting twice does not double the stock",
    num(levelsAfterRepost.body.data.items.find((l) => l.itemId === beefId).quantity) === 8,
    levelsAfterRepost.body?.data,
  );

  // ================= THE LEDGER IS THE TRUTH =================
  const movements = await api(`/admin/stock/movements?itemId=${beefId}`, { token: adminToken });
  check("the receipt is in the ledger", movements.body.data.items.some((m) => m.type === "PURCHASE_IN"), movements.body?.data);
  check("with a running balance", num(movements.body.data.items[0].balanceAfter) === 8, movements.body?.data?.items?.[0]);

  // Corrupt the cache deliberately, then prove the rebuild finds it.
  await prisma.stockLevel.updateMany({
    where: { itemId: beefId, locationId: storeId },
    data: { quantity: 999 },
  });
  const rebuild = await api("/admin/stock/rebuild", { method: "POST", token: adminToken, body: { itemId: beefId } });
  check("rebuilding detects drift between the cache and the ledger", rebuild.body.data.corrected >= 1, rebuild.body?.data);

  const afterRebuild = await api(`/admin/stock/levels?itemId=${beefId}`, { token: adminToken });
  check("and restores the truth", num(afterRebuild.body.data.items[0].quantity) === 8, afterRebuild.body?.data);

  // ================= TRANSFERS =================
  const transferRes = await api("/admin/stock-transfers", {
    method: "POST",
    token: adminToken,
    body: { fromLocationId: storeId, toLocationId: kitchenId, items: [{ itemId: bunId, quantitySent: 40 }] },
  });
  check("a transfer is created", transferRes.status === 201, transferRes.body);
  const transferId = transferRes.body.data.id;

  const sameLocation = await api("/admin/stock-transfers", {
    method: "POST",
    token: adminToken,
    body: { fromLocationId: storeId, toLocationId: storeId, items: [{ itemId: bunId, quantitySent: 1 }] },
  });
  check("a transfer needs two different locations", sameLocation.status === 400, sameLocation.body?.error);

  const tooMuch = await api("/admin/stock-transfers", {
    method: "POST",
    token: adminToken,
    body: { fromLocationId: storeId, toLocationId: kitchenId, items: [{ itemId: bunId, quantitySent: 9999 }] },
  });
  check("a transfer cannot exceed what is on hand", tooMuch.status === 409, tooMuch.body?.error);

  await api(`/admin/stock-transfers/${transferId}/dispatch`, { method: "POST", token: adminToken });

  const inTransitStock = await api(`/admin/stock/levels?branchId=${branchId}`, { token: adminToken });
  const storeBuns = inTransitStock.body.data.items.find((l) => l.itemId === bunId && l.location.id === storeId);
  const kitchenBuns = inTransitStock.body.data.items.find((l) => l.itemId === bunId && l.location.id === kitchenId);
  check("dispatch removes stock from the source", num(storeBuns.quantity) === 60, storeBuns);
  check("but does not add it to the destination yet", !kitchenBuns || num(kitchenBuns.quantity) === 0, kitchenBuns);

  const transit = await api(`/admin/stock-transfers/in-transit?branchId=${branchId}`, { token: adminToken });
  check("in-transit stock is visible", transit.body.data.some((t) => t.id === transferId), transit.body?.data);

  const detail = await api(`/admin/stock-transfers/${transferId}`, { token: adminToken });
  const transferItemId = detail.body.data.items[0].id;

  const received = await api(`/admin/stock-transfers/${transferId}/receive`, {
    method: "POST",
    token: adminToken,
    body: { lines: [{ transferItemId, quantityReceived: 38 }] },
  });
  check("a transfer is received", received.body?.data?.status === "COMPLETED", received.body);

  const afterTransfer = await api(`/admin/stock/levels?branchId=${branchId}`, { token: adminToken });
  const kitchenAfter = afterTransfer.body.data.items.find((l) => l.itemId === bunId && l.location.id === kitchenId);
  check("what arrived is at the destination", num(kitchenAfter.quantity) === 38, kitchenAfter);

  const lostWastage = await prisma.wastage.findFirst({
    where: { itemId: bunId, notes: { contains: "transfer" } },
  });
  check("the shortfall is recorded as a loss, not silently dropped", num(lostWastage?.quantity) === 2, lostWastage);

  // ================= FIFO AND BATCHES =================
  const secondGrn = await api("/admin/goods-receipts", {
    method: "POST",
    token: adminToken,
    body: {
      locationId: storeId,
      supplierId,
      items: [{ itemId: beefId, quantity: 5, unitCost: 2000, batchNumber: `B2-${stamp}` }],
    },
  });
  await api(`/admin/goods-receipts/${secondGrn.body.data.id}/post`, { method: "POST", token: adminToken });

  const twoBatches = await api(`/admin/stock-batches?itemId=${beefId}&status=ACTIVE`, { token: adminToken });
  check("a second delivery is its own batch", twoBatches.body.data.items.length === 2, twoBatches.body?.data);

  const wasteRes = await api("/admin/wastage", {
    method: "POST",
    token: adminToken,
    body: { itemId: beefId, locationId: storeId, quantity: 3, reason: "SPOILED", notes: "Fridge failure" },
  });
  check("wastage is recorded", wasteRes.status === 201, wasteRes.body);
  // FIFO takes the oldest batch first, which cost 1020.
  check("it is costed from the oldest batch, not the newest", round(wasteRes.body.data.unitCost) === 1020, wasteRes.body?.data);

  const afterWaste = await api(`/admin/stock/levels?itemId=${beefId}&locationId=${storeId}`, { token: adminToken });
  check("wastage leaves stock immediately", num(afterWaste.body.data.items[0].quantity) === 10, afterWaste.body?.data);

  const firstBatch = await prisma.stockBatch.findFirst({
    where: { itemId: beefId, batchNumber: `B-${stamp}` },
    select: { id: true, remainingQuantity: true },
  });
  check("the oldest batch is drawn down", num(firstBatch.remainingQuantity) === 5, firstBatch);

  const quarantined = await api(`/admin/stock-batches/${firstBatch.id}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "QUARANTINED", notes: "Supplier recall" },
  });
  check("a batch can be quarantined", quarantined.body?.data?.status === "QUARANTINED", quarantined.body);

  const afterQuarantine = await api("/admin/wastage", {
    method: "POST",
    token: adminToken,
    body: { itemId: beefId, locationId: storeId, quantity: 1, reason: "SPOILED" },
  });
  check("quarantined stock is skipped by FIFO", round(afterQuarantine.body.data.unitCost) === 2000, afterQuarantine.body?.data);

  const writtenOff = await api(`/admin/stock-batches/${firstBatch.id}/write-off`, {
    method: "POST",
    token: adminToken,
    body: { reason: "SPOILED", notes: "Recall confirmed" },
  });
  check("a batch can be written off entirely", writtenOff.status === 200, writtenOff.body?.error);

  const writeOffMovement = await prisma.stockMovement.findFirst({
    where: { itemId: beefId, referenceType: "BATCH_WRITE_OFF" },
  });
  check("the write-off appears in the ledger", Boolean(writeOffMovement), writeOffMovement);

  // ================= VALUATION =================
  const valuation = await api(`/admin/stock/valuation?branchId=${branchId}`, { token: adminToken });
  check("stock has a value", num(valuation.body.data.totalValue) > 0, valuation.body?.data);
  check("grouped by category", valuation.body.data.byCategory.length >= 1, valuation.body?.data?.byCategory);

  // ================= COUNTS =================
  const countRes = await api("/admin/stock-counts", {
    method: "POST",
    token: adminToken,
    body: { locationId: kitchenId, scope: "Kitchen spot check" },
  });
  check("a count sheet is opened", countRes.status === 201, countRes.body);
  const countId = countRes.body.data.id;

  const secondCount = await api("/admin/stock-counts", {
    method: "POST",
    token: adminToken,
    body: { locationId: kitchenId },
  });
  check("one location cannot have two open counts", secondCount.status === 409, secondCount.body?.error);

  const blind = await api(`/admin/stock-counts/${countId}?blind=true`, { token: adminToken });
  check("a blind sheet hides the expected quantity", blind.body.data.items[0].systemQuantity === undefined, blind.body?.data?.items?.[0]);

  const sighted = await api(`/admin/stock-counts/${countId}`, { token: adminToken });
  check("but a manager can see it", num(sighted.body.data.items[0].systemQuantity) === 38, sighted.body?.data?.items?.[0]);

  const partial = await api(`/admin/stock-counts/${countId}/submit`, {
    method: "POST",
    token: adminToken,
    body: { lines: [] },
  });
  check("an empty count cannot be submitted", partial.status === 400, partial.body?.error);

  const submitted = await api(`/admin/stock-counts/${countId}/submit`, {
    method: "POST",
    token: adminToken,
    body: { lines: [{ itemId: bunId, countedQuantity: 35, reason: "Two dropped" }] },
  });
  check("counted quantities are submitted", submitted.body?.data?.status === "PENDING_APPROVAL", submitted.body);
  check("the variance is computed", num(submitted.body.data.items[0].varianceQuantity) === -3, submitted.body?.data?.items?.[0]);

  const notPostedYet = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${kitchenId}`, { token: adminToken });
  check("submitting does not move stock", num(notPostedYet.body.data.items[0].quantity) === 38, notPostedYet.body?.data);

  const postedCount = await api(`/admin/stock-counts/${countId}/post`, { method: "POST", token: adminToken });
  check("posting the count succeeds", postedCount.body?.data?.status === "COMPLETED", postedCount.body);

  const afterCount = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${kitchenId}`, { token: adminToken });
  check("the correction is applied", num(afterCount.body.data.items[0].quantity) === 35, afterCount.body?.data);

  const correction = await prisma.stockMovement.findFirst({
    where: { itemId: bunId, type: "COUNT_CORRECTION" },
  });
  check("as a ledger movement, not a silent edit", num(correction?.quantity) === -3, correction);

  const repostCount = await api(`/admin/stock-counts/${countId}/post`, { method: "POST", token: adminToken });
  const afterRepost = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${kitchenId}`, { token: adminToken });
  check("posting twice does not double the correction", num(afterRepost.body.data.items[0].quantity) === 35, afterRepost.body?.data);

  // ================= ADJUSTMENTS =================
  const noReason = await api("/admin/stock-adjustments", {
    method: "POST",
    token: adminToken,
    body: { locationId: storeId, items: [{ itemId: bunId, quantity: 5 }] },
  });
  check("an adjustment needs a reason", noReason.status === 400, noReason.body?.error);

  const adjRes = await api("/admin/stock-adjustments", {
    method: "POST",
    token: adminToken,
    body: {
      locationId: storeId,
      reason: "Found a forgotten case",
      items: [{ itemId: bunId, quantity: 12 }],
    },
  });
  check("an adjustment is raised for approval", adjRes.body?.data?.status === "PENDING_APPROVAL", adjRes.body);
  const adjId = adjRes.body.data.id;

  const beforeApproval = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${storeId}`, { token: adminToken });
  check("an unapproved adjustment moves nothing", num(beforeApproval.body.data.items[0].quantity) === 60, beforeApproval.body?.data);

  await api(`/admin/stock-adjustments/${adjId}/approve`, { method: "POST", token: adminToken });
  const afterApproval = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${storeId}`, { token: adminToken });
  check("approving posts it", num(afterApproval.body.data.items[0].quantity) === 72, afterApproval.body?.data);

  const adjAudit = await prisma.auditLog.findFirst({
    where: { action: "stock_adjustment.approve", entityId: adjId },
  });
  check("approving an adjustment is audited", Boolean(adjAudit), adjAudit);

  // ================= REORDER AND REPORTS =================
  const reorder = await api(`/admin/stock/reorder?branchId=${branchId}`, { token: adminToken });
  check("items below their reorder level are listed", Array.isArray(reorder.body.data), reorder.body?.data);

  const wasteReport = await api(`/admin/wastage/report?branchId=${branchId}`, { token: adminToken });
  check("wastage is reported by reason", wasteReport.body.data.byReason.length >= 1, wasteReport.body?.data);
  check("with a value attached", num(wasteReport.body.data.totalValue) > 0, wasteReport.body?.data);

  // ================= SALE-TIME DEPLETION =================
  const catRes = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `Mains ${stamp}` } });
  const burgerRes = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Burger ${stamp}`, categoryId: catRes.body.data.id, price: 1500 },
  });
  const burgerId = burgerRes.body.data.id;
  await api(`/admin/products/${burgerId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });
  const variantId = burgerRes.body.data.variants[0].id;

  const menuRes = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, isActive: true, name: `Main ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  await api(`/admin/menus/${menuRes.body.data.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: burgerId },
  });

  // The recipe: 150g of beef (an item that yields 80%) and one bun.
  const recipe = await prisma.recipe.create({
    data: {
      name: `Burger recipe ${stamp}`,
      variantId,
      yieldQuantity: 1,
      yieldUomId: pcId,
      isActive: true,
      ingredients: {
        create: [
          { itemId: beefId, quantity: 0.15, uomId: kgId },
          { itemId: bunId, quantity: 1, uomId: pcId },
        ],
      },
    },
    select: { id: true },
  });

  const beefBefore = await api(`/admin/stock/levels?itemId=${beefId}&locationId=${storeId}`, { token: adminToken });
  const bunBefore = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${storeId}`, { token: adminToken });

  const orderRes = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      type: "DINE_IN",
      channel: "POS",
      items: [{ productId: burgerId, quantity: 2 }],
      guest: { name: "Walk-in" },
    },
  });
  const orderId = orderRes.body.data.id;

  for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
    await api(`/admin/orders/${orderId}/status`, { method: "PUT", token: adminToken, body: { status } });
  }

  await drainOutbox();

  const beefAfter = await api(`/admin/stock/levels?itemId=${beefId}&locationId=${storeId}`, { token: adminToken });
  const bunAfter = await api(`/admin/stock/levels?itemId=${bunId}&locationId=${storeId}`, { token: adminToken });

  const beefUsed = num(beefBefore.body.data.items[0].quantity) - num(beefAfter.body.data.items[0].quantity);
  const bunsUsed = num(bunBefore.body.data.items[0].quantity) - num(bunAfter.body.data.items[0].quantity);

  // Two burgers x 150g = 300g net; at 80% yield that is 375g drawn from stock.
  check("selling a dish deducts what it was made of", round(beefUsed, 6) === 0.375, { beefUsed });
  check("yield is grossed up, not ignored", round(beefUsed, 6) !== 0.3, { beefUsed });
  check("every ingredient is deducted", bunsUsed === 2, { bunsUsed });

  const saleMovements = await prisma.stockMovement.count({ where: { orderId, type: "SALE_OUT" } });
  check("the deduction is tagged to the order", saleMovements === 2, { saleMovements });

  await drainOutbox();
  const stillTwo = await prisma.stockMovement.count({ where: { orderId, type: "SALE_OUT" } });
  check("draining the outbox again does not deduct twice", stillTwo === 2, { stillTwo });

  const variance = await api(`/admin/stock/usage-variance?branchId=${branchId}`, { token: adminToken });
  check("theoretical usage is reportable", Array.isArray(variance.body.data), variance.body?.data);

  // ================= LOW STOCK ALERT =================
  /*
   * Beef has been wasted and cooked with, so it is under its reorder level of
   * 5. The nightly maintenance job is what notices; nothing in the ordering
   * path does, which is the point — somebody has to be told before the shelf
   * is empty, not when a customer orders the thing that ran out.
   */
  const runMaintenance = async () => {
    const res = await fetch(`${BASE}/api/internal/jobs/maintenance`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "phase2-test-secret"}` },
    });
    return res.ok ? (await res.json().catch(() => null))?.data : null;
  };

  const firstSweep = await runMaintenance();
  check("the maintenance job reports on low stock", Boolean(firstSweep?.lowStock), firstSweep?.lowStock);
  check(
    "and found somebody who could act on it",
    (firstSweep?.lowStock?.audience ?? 0) > 0,
    firstSweep?.lowStock,
  );

  const alerts = await prisma.notification.findMany({
    where: { type: "inventory.low_stock", data: { path: ["branchId"], equals: branchId } },
    select: { id: true, title: true, body: true, data: true },
  });
  check("a low-stock alert was raised for the branch", alerts.length > 0, { count: alerts.length });
  check("it names the item that is short", alerts.some((row) => row.body?.includes(`Beef ${stamp}`)), alerts[0]?.body);
  check("and says what to do about it", alerts.some((row) => /purchase order/i.test(row.body ?? "")), alerts[0]?.body);

  /*
   * The hard part of an alert is not raising it, it is not raising it again
   * every night. Nothing has newly gone low, so a second sweep must stay
   * quiet — otherwise the channel becomes noise and the next real warning is
   * dismissed with the rest.
   */
  const secondSweep = await runMaintenance();
  check("a second sweep adds nothing while the same items are low", secondSweep?.lowStock?.alerted === 0, secondSweep?.lowStock);

  const afterSecond = await prisma.notification.count({
    where: { type: "inventory.low_stock", data: { path: ["branchId"], equals: branchId } },
  });
  check("so the count of alerts is unchanged", afterSecond === alerts.length, { before: alerts.length, afterSecond });

  // ================= PERMISSIONS =================
  const custReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P9 Customer", email: emailOf("cust"), password: "customer-passphrase-9" },
  });
  created.userIds.add(custReg.body.data.user.id);
  await prisma.user.update({ where: { id: custReg.body.data.user.id }, data: { emailVerifiedAt: new Date() } });
  const customerToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cust"), password: "customer-passphrase-9" } })
  ).body.data.accessToken;

  const custStock = await api(`/admin/stock/levels?branchId=${branchId}`, { token: customerToken });
  check("a customer cannot see stock", custStock.status === 403, custStock.body?.error);

  const custValuation = await api(`/admin/stock/valuation?branchId=${branchId}`, { token: customerToken });
  check("nor what it is worth", custValuation.status === 403, custValuation.body?.error);

  // A storeman who can see stock but not cost prices.
  const storeReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P9 Storeman", email: emailOf("store"), password: "storeman-passphrase-9" },
  });
  const storemanId = storeReg.body.data.user.id;
  created.userIds.add(storemanId);
  await prisma.user.update({ where: { id: storemanId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P9 Storeman ${stamp}`, description: "Counts stock, cannot see cost" },
  });
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["stock.read", "stock_counts.read", "stock_counts.submit"] },
  });
  await api(`/admin/users/${storemanId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: role.body.data.id, branchId },
  });
  const storeToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("store"), password: "storeman-passphrase-9" } })
  ).body.data.accessToken;

  const storeSees = await api(`/admin/stock/levels?branchId=${branchId}`, { token: storeToken });
  check("a storeman can see stock on hand", storeSees.status === 200, storeSees.body?.error);

  const storeCost = await api(`/admin/stock/valuation?branchId=${branchId}`, { token: storeToken });
  check("but not cost prices", storeCost.status === 403, storeCost.body?.error);

  const storePosts = await api(`/admin/stock-counts/${countId}/post`, { method: "POST", token: storeToken });
  check("nor approve their own count", storePosts.status === 403, storePosts.body?.error);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const orders = await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  const locations = await prisma.stockLocation.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const locationIds = locations.map((l) => l.id);
  const items = await prisma.inventoryItem.findMany({
    where: { name: { contains: String(stamp) } },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);

  await prisma.recipeIngredient.deleteMany({ where: { recipe: { name: { contains: String(stamp) } } } });
  await prisma.recipe.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.stockMovement.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.wastage.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockCountItem.deleteMany({ where: { stockCount: { branchId: { in: branchIds } } } });
  await prisma.stockCount.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.stockAdjustmentItem.deleteMany({ where: { adjustment: { locationId: { in: locationIds } } } });
  await prisma.stockAdjustment.deleteMany({ where: { locationId: { in: locationIds } } });
  await prisma.stockTransferItem.deleteMany({ where: { transfer: { fromLocationId: { in: locationIds } } } });
  await prisma.stockTransfer.deleteMany({ where: { fromLocationId: { in: locationIds } } });
  await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { branchId: { in: branchIds } } } });
  await prisma.goodsReceipt.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { branchId: { in: branchIds } } } });
  await prisma.purchaseOrder.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.stockBatch.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockLevel.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockLocation.deleteMany({ where: { branchId: { in: branchIds } } });

  await prisma.supplierItem.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.supplier.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.inventoryCategory.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.unitOfMeasure.deleteMany({ where: { id: { in: [...created.unitIds] } } });

  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
  for (const id of orderIds) {
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["orderId"], equals: id } } });
  }

  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E9" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    items: await prisma.inventoryItem.count(),
    locations: await prisma.stockLocation.count(),
    levels: await prisma.stockLevel.count(),
    movements: await prisma.stockMovement.count(),
    batches: await prisma.stockBatch.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    receipts: await prisma.goodsReceipt.count(),
    suppliers: await prisma.supplier.count(),
    units: await prisma.unitOfMeasure.count(),
    orders: await prisma.order.count(),
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

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));

  const dirty = Object.entries(leftovers).filter(([key, value]) => key !== "roles" && value > 0);
  if (dirty.length) console.log("WARNING: database not clean:", JSON.stringify(dirty));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
