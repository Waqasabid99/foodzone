import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 10 — Recipes, costing and production, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * The arithmetic — roll-ups, variances, by-product credit, unit conversion
 * through a sub-recipe — is pinned in tests/unit.mjs. What only a database can
 * prove is here: that a recipe version stops being editable the moment it has
 * been produced against, that a production run moves exactly the stock it says
 * it moved and puts it all back when cancelled, that the ledger and the level
 * cache still agree afterwards, and that costs are withheld from a role that
 * may read a recipe but not its margin.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e10-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2EA${String(stamp).slice(-5)}`;
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
const nextIp = () => `10.91.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

const num = (value) => Number(value ?? 0);
const round = (value, dp = 4) => Math.round(Number(value ?? 0) * 10 ** dp) / 10 ** dp;

async function levelOf(itemId, locationId) {
  const level = await prisma.stockLevel.findUnique({
    where: { itemId_locationId: { itemId, locationId } },
    select: { quantity: true },
  });
  return Number(level?.quantity ?? 0);
}

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P10 Admin", email: emailOf("admin"), password: "admin-passphrase-10" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-10" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P10 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  // ================= UNITS =================
  const suffix = String(stamp).slice(-5);
  const mk = async (payload) => {
    const res = await api("/admin/units", { method: "POST", token: adminToken, body: payload });
    created.unitIds.add(res.body?.data?.id);
    return res.body?.data?.id;
  };

  const kgId = await mk({ code: `KG${suffix}`, name: "Kilogram", type: "WEIGHT", precision: 3 });
  const gId = await mk({ code: `G${suffix}`, name: "Gram", type: "WEIGHT", baseUnitId: kgId, factor: 0.001 });
  const litreId = await mk({ code: `L${suffix}`, name: "Litre", type: "VOLUME", precision: 3 });
  const mlId = await mk({ code: `ML${suffix}`, name: "Millilitre", type: "VOLUME", baseUnitId: litreId, factor: 0.001 });
  const pcId = await mk({ code: `PC${suffix}`, name: "Piece", type: "COUNT", precision: 0 });

  const storeRes = await api("/admin/stock-locations", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Main store", code: "MAIN", type: "MAIN_STORE", isDefault: true },
  });
  const storeId = storeRes.body.data.id;

  // ================= ITEMS =================
  const mkItem = async (payload) => {
    const res = await api("/admin/inventory-items", { method: "POST", token: adminToken, body: payload });
    return res.body?.data?.id;
  };

  const tomatoId = await mkItem({ name: `Tomato ${stamp}`, uomId: kgId, type: "RAW_MATERIAL", costingMethod: "WEIGHTED_AVERAGE" });
  const cheeseId = await mkItem({ name: `Cheese ${stamp}`, uomId: kgId, type: "RAW_MATERIAL", costingMethod: "WEIGHTED_AVERAGE" });
  const basilId = await mkItem({ name: `Basil ${stamp}`, uomId: kgId, type: "RAW_MATERIAL" });
  const baseId = await mkItem({ name: `Pizza base ${stamp}`, uomId: pcId, type: "RAW_MATERIAL" });

  const sauceRes = await api("/admin/inventory-items", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Tomato sauce ${stamp}`,
      uomId: litreId,
      type: "SEMI_FINISHED",
      costingMethod: "WEIGHTED_AVERAGE",
      trackBatches: true,
      isPerishable: true,
      shelfLifeDays: 4,
    },
  });
  const sauceId = sauceRes.body.data.id;

  const stockId = await mkItem({ name: `Veg stock ${stamp}`, uomId: litreId, type: "SEMI_FINISHED" });

  // Real costs, from a real delivery: 20 kg tomato at 200, 5 kg cheese at 1200,
  // 100 bases at 30. Basil is deliberately never received, so it has no cost.
  const supplierRes = await api("/admin/suppliers", {
    method: "POST",
    token: adminToken,
    body: { code: `SUP${String(stamp).slice(-6)}`, name: `Produce Co ${stamp}` },
  });
  const supplierId = supplierRes.body.data.id;

  const grn = await api("/admin/goods-receipts", {
    method: "POST",
    token: adminToken,
    body: {
      locationId: storeId,
      supplierId,
      items: [
        { itemId: tomatoId, quantity: 20, unitCost: 200, uomId: kgId },
        { itemId: cheeseId, quantity: 5, unitCost: 1200, uomId: kgId },
        { itemId: baseId, quantity: 100, unitCost: 30, uomId: pcId },
      ],
    },
  });
  const grnId = grn.body.data.id;
  const posted = await api(`/admin/goods-receipts/${grnId}/post`, { method: "POST", token: adminToken });
  check("stock is received so recipes have real costs", posted.body?.data?.status === "COMPLETED", posted.body);

  // ================= RECIPE VALIDATION =================
  const bothOutputs = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Bad ${stamp}`,
      outputItemId: sauceId,
      variantId: sauceId,
      yieldUomId: litreId,
      ingredients: [{ itemId: tomatoId, quantity: 1, uomId: kgId }],
    },
  });
  check("a recipe cannot make two things at once", bothOutputs.status === 400, bothOutputs.body?.error);

  const noOutput = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: { name: `Bad ${stamp}`, yieldUomId: litreId, ingredients: [{ itemId: tomatoId, quantity: 1, uomId: kgId }] },
  });
  check("a recipe has to make something", noOutput.status === 400, noOutput.body?.error);

  const rawOutput = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Bad raw ${stamp}`,
      outputItemId: tomatoId,
      yieldUomId: kgId,
      ingredients: [{ itemId: cheeseId, quantity: 1, uomId: kgId }],
    },
  });
  check("a raw material is bought, not produced by a recipe", rawOutput.status === 400, rawOutput.body?.error);

  const crossType = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Bad units ${stamp}`,
      outputItemId: sauceId,
      yieldUomId: litreId,
      ingredients: [{ itemId: tomatoId, quantity: 1, uomId: litreId }],
    },
  });
  check("an ingredient measured in the wrong kind of unit is refused", crossType.status === 400, crossType.body?.error);

  const duplicated = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Duplicated ${stamp}`,
      outputItemId: sauceId,
      yieldUomId: litreId,
      ingredients: [
        { itemId: tomatoId, quantity: 1, uomId: kgId },
        { itemId: tomatoId, quantity: 2, uomId: kgId },
      ],
    },
  });
  check("the same ingredient cannot be on a recipe twice", duplicated.status === 400, duplicated.body?.error);

  const bothKinds = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Bad line ${stamp}`,
      outputItemId: sauceId,
      yieldUomId: litreId,
      ingredients: [{ itemId: tomatoId, subRecipeId: tomatoId, quantity: 1, uomId: kgId }],
    },
  });
  check("an ingredient is an item or a sub-recipe, never both", bothKinds.status === 400, bothKinds.body?.error);

  // ================= THE SAUCE SUB-RECIPE =================
  // 2 litres of sauce from 3 kg of tomato, 100 g of basil, 50 labour, 20 overhead.
  const sauceRecipe = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Tomato sauce ${stamp}`,
      outputItemId: sauceId,
      yieldQuantity: 2,
      yieldUomId: litreId,
      isBatchProduced: true,
      laborCost: 50,
      overheadCost: 20,
      ingredients: [
        { itemId: tomatoId, quantity: 3, uomId: kgId },
        { itemId: basilId, quantity: 100, uomId: gId },
      ],
    },
  });
  check("a sub-recipe is created", sauceRecipe.status === 201, sauceRecipe.body);
  const sauceRecipeId = sauceRecipe.body.data.id;
  check("the first version is 1", sauceRecipe.body.data.version === 1, sauceRecipe.body?.data);

  const sauceCost = await api(`/admin/recipes/${sauceRecipeId}/cost`, { token: adminToken });
  // 3 kg tomato at 200 = 600. Basil has no cost. Plus 50 + 20 over 2 litres.
  check("material cost is the ingredients at their real cost", num(sauceCost.body.data.materialCost) === 600, sauceCost.body?.data);
  check("labour and overhead are inside the unit cost", num(sauceCost.body.data.unitCost) === 335, sauceCost.body?.data);
  check(
    "an ingredient with no cost is reported, not silently treated as free",
    sauceCost.body.data.missingCosts.some((row) => row.itemId === basilId),
    sauceCost.body?.data?.missingCosts,
  );
  check("a partly-priced recipe says so", sauceCost.body.data.isFullyCosted === false, sauceCost.body?.data);

  // ================= NESTING AND UNIT CONVERSION =================
  const categoryRes = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Pizza ${stamp}`, slug: `pizza-${stamp}` },
  });
  const categoryId = categoryRes.body.data.id;

  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Margherita ${stamp}`,
      categoryId,
      type: "VARIANT",
      variants: [{ name: "Regular", price: 900, isDefault: true }],
    },
  });
  const variantId = product.body.data.variants[0].id;

  // One pizza: 1 base, 150 ml of the sauce, 120 g cheese.
  const pizzaRecipe = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Margherita ${stamp}`,
      variantId,
      yieldQuantity: 1,
      yieldUomId: pcId,
      ingredients: [
        { itemId: baseId, quantity: 1, uomId: pcId },
        { subRecipeId: sauceRecipeId, quantity: 150, uomId: mlId },
        { itemId: cheeseId, quantity: 120, uomId: gId },
      ],
    },
  });
  check("a recipe can nest another recipe", pizzaRecipe.status === 201, pizzaRecipe.body);
  const pizzaRecipeId = pizzaRecipe.body.data.id;

  const pizzaCost = await api(`/admin/recipes/${pizzaRecipeId}/cost`, { token: adminToken });
  const sauceLine = pizzaCost.body.data.ingredients.find((line) => line.kind === "SUB_RECIPE");
  // 150 ml against a recipe yielding 2 litres is 0.15 L, not 150.
  check(
    "a sub-recipe quantity is converted into the sub-recipe's yield unit",
    num(sauceLine.quantity) === 0.15,
    sauceLine,
  );
  check("the sub-recipe is priced at its own rolled-up unit cost", num(sauceLine.unitCost) === 335, sauceLine);
  check("the nested line costs quantity times that", round(num(sauceLine.totalCost)) === 50.25, sauceLine);
  // 30 (base) + 50.25 (sauce) + 144 (120 g cheese at 1200/kg) = 224.25
  check("a nested recipe rolls up through every level", round(num(pizzaCost.body.data.unitCost)) === 224.25, pizzaCost.body?.data);
  check("a nested recipe inherits its sub-recipe's missing costs", pizzaCost.body.data.isFullyCosted === false, pizzaCost.body?.data);

  // ================= MENU COSTING =================
  const recost = await api(`/admin/recipes/${pizzaRecipeId}/recost`, { method: "POST", token: adminToken });
  check("recosting caches the roll-up", round(num(recost.body.data.unitCost)) === 224.25, recost.body?.data);

  const variantRow = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { standardCost: true } });
  check(
    "the variant's standard cost is refreshed, so a sale can snapshot COGS",
    round(num(variantRow.standardCost)) === 224.25,
    variantRow,
  );

  const menu = await api(`/admin/recipes/menu-cost?branchId=${branchId}`, { token: adminToken });
  const menuRow = menu.body.data.find((row) => row.variantId === variantId);
  // 224.25 against a 900 price.
  check("food cost percent is cost over price", menuRow.foodCostPercent === 24.92, menuRow);
  check("contribution margin is what is left", round(num(menuRow.contributionMargin)) === 675.75, menuRow);

  // ================= VERSIONING =================
  const editable = await api(`/admin/recipes/${sauceRecipeId}`, {
    method: "PATCH",
    token: adminToken,
    body: { laborCost: 60 },
  });
  check("an unused recipe can be edited in place", editable.status === 200, editable.body);
  check("editing clears the cached cost rather than leaving a stale one", editable.body.data.computedUnitCost === null, editable.body?.data);

  const revised = await api(`/admin/recipes/${sauceRecipeId}/revise`, {
    method: "POST",
    token: adminToken,
    body: { ingredients: [{ itemId: tomatoId, quantity: 3.5, uomId: kgId }] },
  });
  check("revising creates the next version", revised.status === 201 && revised.body.data.version === 2, revised.body);
  const sauceV2Id = revised.body.data.id;
  check("a revision carries forward what was not changed", num(revised.body.data.laborCost) === 60, revised.body?.data);

  const v1 = await prisma.recipe.findUnique({ where: { id: sauceRecipeId }, select: { isActive: true } });
  check("the old version is deactivated, not deleted", v1.isActive === false, v1);

  const versions = await api(`/admin/recipes/versions?outputItemId=${sauceId}`, { token: adminToken });
  check("both versions are listed, newest first", versions.body.data.length === 2 && versions.body.data[0].version === 2, versions.body?.data);

  const rolledBack = await api(`/admin/recipes/${sauceRecipeId}/activate`, { method: "POST", token: adminToken });
  check("an old version can be made live again", rolledBack.body?.data?.isActive === true, rolledBack.body);
  const v2After = await prisma.recipe.findUnique({ where: { id: sauceV2Id }, select: { isActive: true } });
  check("only one version is live at a time", v2After.isActive === false, v2After);
  await api(`/admin/recipes/${sauceV2Id}/activate`, { method: "POST", token: adminToken });

  const usedAsSub = await api(`/admin/recipes/${sauceRecipeId}`, { method: "DELETE", token: adminToken });
  check("a recipe used as an ingredient cannot be deleted", usedAsSub.status === 409, usedAsSub.body?.error);

  // ================= CYCLES =================
  const stockRecipe = await api("/admin/recipes", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Veg stock ${stamp}`,
      outputItemId: stockId,
      yieldQuantity: 5,
      yieldUomId: litreId,
      ingredients: [{ subRecipeId: sauceV2Id, quantity: 500, uomId: mlId }],
    },
  });
  check("a recipe can use another as an ingredient", stockRecipe.status === 201, stockRecipe.body);
  const stockRecipeId = stockRecipe.body.data.id;

  const cycle = await api(`/admin/recipes/${sauceV2Id}`, {
    method: "PATCH",
    token: adminToken,
    body: { ingredients: [{ subRecipeId: stockRecipeId, quantity: 1, uomId: litreId }] },
  });
  check("a recipe cannot end up including itself", cycle.status === 400, cycle.body?.error);

  const selfCycle = await api(`/admin/recipes/${sauceV2Id}`, {
    method: "PATCH",
    token: adminToken,
    body: { ingredients: [{ subRecipeId: sauceV2Id, quantity: 1, uomId: litreId }] },
  });
  check("a recipe cannot include itself directly", selfCycle.status === 400, selfCycle.body?.error);

  // ================= COST VISIBILITY =================
  const chefReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P10 Chef", email: emailOf("chef"), password: "chef-passphrase-10" },
  });
  const chefId = chefReg.body.data.user.id;
  created.userIds.add(chefId);
  await prisma.user.update({ where: { id: chefId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const chefRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P10 Chef ${stamp}`, description: "Reads recipes, not margins" },
  });
  await api(`/admin/roles/${chefRole.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["recipes.read", "production_orders.read"] },
  });
  await api(`/admin/users/${chefId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: chefRole.body.data.id, branchId },
  });
  const chefToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("chef"), password: "chef-passphrase-10" } })
  ).body.data.accessToken;

  const chefReads = await api(`/admin/recipes/${pizzaRecipeId}`, { token: chefToken });
  check("the role really does grant recipe access", chefReads.status === 200, chefReads.body?.error);
  check("a chef sees the ingredients", chefReads.body.data.ingredients.length === 3, chefReads.body?.data);
  check("a chef does not see the cost", chefReads.body.data.computedUnitCost === undefined, chefReads.body?.data);

  const chefCost = await api(`/admin/recipes/${pizzaRecipeId}/cost`, { token: chefToken });
  check("costing needs its own permission, not just recipe access", chefCost.status === 403, chefCost.body?.error);

  // ================= PRODUCTION: PLANNING =================
  const variantRun = await api("/admin/production-orders", {
    method: "POST",
    token: adminToken,
    body: { locationId: storeId, recipeId: pizzaRecipeId, plannedQuantity: 1 },
  });
  check("a recipe that makes a menu item cannot be batch produced", variantRun.status === 400, variantRun.body?.error);

  const run = await api("/admin/production-orders", {
    method: "POST",
    token: adminToken,
    body: { locationId: storeId, recipeId: sauceV2Id, plannedQuantity: 2, notes: "Morning batch" },
  });
  check("a production run is planned", run.status === 201, run.body);
  const runId = run.body.data.id;
  check("a planned run is numbered", String(run.body.data.productionNumber ?? "").startsWith(`PRD-${BRANCH_CODE}`), run.body?.data);
  check("a planned run has moved nothing", run.body.data.status === "PLANNED", run.body?.data);
  // 3.5 kg tomato at 200 = 700, plus 60 labour and 20 overhead = 780 for 2 litres.
  check("the standard cost is frozen from the recipe", num(run.body.data.standardCost) === 780, run.body?.data);

  const plan = await api(`/admin/production-orders/${runId}/plan`, { token: adminToken });
  const tomatoPlan = plan.body.data.materials.find((line) => line.itemId === tomatoId);
  check("the pick list says what to take off the shelf", num(tomatoPlan.plannedQuantity) === 3.5, plan.body?.data);

  const tomatoBefore = await levelOf(tomatoId, storeId);
  check("stock is untouched while the run is only planned", tomatoBefore === 20, tomatoBefore);

  // ================= PRODUCTION: STARTING =================
  const tooBig = await api("/admin/production-orders", {
    method: "POST",
    token: adminToken,
    body: { locationId: storeId, recipeId: sauceV2Id, plannedQuantity: 100 },
  });
  const tooBigId = tooBig.body.data.id;
  const refusedStart = await api(`/admin/production-orders/${tooBigId}/start`, { method: "POST", token: adminToken, body: {} });
  check("a run cannot start on stock that is not there", refusedStart.status === 409, refusedStart.body?.error);
  const stillThere = await levelOf(tomatoId, storeId);
  check("a refused start moves nothing at all", stillThere === 20, stillThere);
  await api(`/admin/production-orders/${tooBigId}/cancel`, { method: "POST", token: adminToken, body: { reason: "too big" } });

  const started = await api(`/admin/production-orders/${runId}/start`, { method: "POST", token: adminToken, body: {} });
  check("a run starts and issues its material", started.body?.data?.status === "IN_PROGRESS", started.body);
  check("the material cost is what was actually drawn", num(started.body.data.materialCost) === 700, started.body?.data);

  const tomatoAfterStart = await levelOf(tomatoId, storeId);
  check("issuing material takes it off the shelf", round(tomatoAfterStart) === 16.5, tomatoAfterStart);

  const restart = await api(`/admin/production-orders/${runId}/start`, { method: "POST", token: adminToken, body: {} });
  check("a run cannot be started twice", restart.status === 409, restart.body?.error);

  const editStarted = await api(`/admin/production-orders/${runId}`, {
    method: "PATCH",
    token: adminToken,
    body: { plannedQuantity: 5 },
  });
  check("a started run cannot be re-planned", editStarted.status === 409, editStarted.body?.error);

  const topUp = await api(`/admin/production-orders/${runId}/consume`, {
    method: "POST",
    token: adminToken,
    body: { items: [{ itemId: tomatoId, quantity: 0.5 }] },
  });
  check("more material can be issued to a run under way", topUp.status === 200, topUp.body);
  check("the extra draw is added to the run's cost", num(topUp.body.data.materialCost) === 800, topUp.body?.data);

  const detail = await api(`/admin/production-orders/${runId}`, { token: adminToken });
  const tomatoUsage = detail.body.data.materials.find((line) => line.itemId === tomatoId);
  check("planned and actual usage sit side by side", num(tomatoUsage.plannedQuantity) === 3.5 && num(tomatoUsage.actualQuantity) === 4, tomatoUsage);
  check("using more than planned shows as a usage variance", num(tomatoUsage.usageVariance) === 0.5, tomatoUsage);

  // ================= PRODUCTION: COMPLETING =================
  const sauceBefore = await levelOf(sauceId, storeId);
  const completed = await api(`/admin/production-orders/${runId}/complete`, {
    method: "POST",
    token: adminToken,
    body: { producedQuantity: 1.8, wastedQuantity: 0.2, wastageReason: "PRODUCTION_LOSS" },
  });
  check("a run completes", completed.body?.data?.status === "COMPLETED", completed.body);
  // 800 material + 60 labour + 20 overhead = 880 over 2 litres made.
  check("the total cost is material plus labour plus overhead", num(completed.body.data.totalCost) === 880, completed.body?.data);
  check("the unit cost spreads over everything made, good and wasted", num(completed.body.data.unitCost) === 440, completed.body?.data);
  check("overspending against the standard is unfavourable", completed.body.data.costVariance.favourable === false, completed.body?.data?.costVariance);
  check("the cost variance is actual less standard", num(completed.body.data.costVariance.variance) === 100, completed.body?.data?.costVariance);
  check("the yield variance is what came out against the plan", completed.body.data.yieldVariance.yieldPercent === 90, completed.body?.data?.yieldVariance);

  const sauceAfter = await levelOf(sauceId, storeId);
  check("only the usable output stays in stock", round(sauceAfter - sauceBefore) === 1.8, { sauceBefore, sauceAfter });

  const wastage = await prisma.wastage.findFirst({ where: { productionOrderId: runId }, select: { quantity: true, totalCost: true, reason: true } });
  check("yield loss is booked as costed wastage against the run", num(wastage?.quantity) === 0.2, wastage);
  check("the wasted output carries its share of the cost", num(wastage?.totalCost) === 88, wastage);
  check("production loss has its own wastage reason", wastage?.reason === "PRODUCTION_LOSS", wastage);

  const batch = await prisma.stockBatch.findFirst({ where: { productionOrderId: runId }, select: { batchNumber: true, remainingQuantity: true, unitCost: true, expiryDate: true } });
  check("a batch-tracked output gets a batch", Boolean(batch), batch);
  check("the batch holds only what survived", round(num(batch?.remainingQuantity)) === 1.8, batch);
  check("the batch is priced at what the run actually cost", num(batch?.unitCost) === 440, batch);
  check("a perishable output gets an expiry from its shelf life", Boolean(batch?.expiryDate), batch);

  const recomplete = await api(`/admin/production-orders/${runId}/complete`, {
    method: "POST",
    token: adminToken,
    body: { producedQuantity: 1 },
  });
  check("a completed run is terminal", recomplete.status === 409, recomplete.body?.error);

  const lateCancel = await api(`/admin/production-orders/${runId}/cancel`, { method: "POST", token: adminToken, body: {} });
  check("a completed run cannot be cancelled", lateCancel.status === 409, lateCancel.body?.error);

  // ================= PRODUCTION: CANCELLING =================
  const tomatoBeforeCancel = await levelOf(tomatoId, storeId);
  const doomed = await api("/admin/production-orders", {
    method: "POST",
    token: adminToken,
    body: { locationId: storeId, recipeId: sauceV2Id, plannedQuantity: 2 },
  });
  const doomedId = doomed.body.data.id;
  await api(`/admin/production-orders/${doomedId}/start`, { method: "POST", token: adminToken, body: {} });
  const midRun = await levelOf(tomatoId, storeId);
  check("starting the doomed run draws its material", round(tomatoBeforeCancel - midRun) === 3.5, { tomatoBeforeCancel, midRun });

  const cancelled = await api(`/admin/production-orders/${doomedId}/cancel`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Oven failed" },
  });
  check("a run under way can be cancelled", cancelled.body?.data?.status === "CANCELLED", cancelled.body);
  const afterCancel = await levelOf(tomatoId, storeId);
  check("cancelling puts every gram back", round(afterCancel) === round(tomatoBeforeCancel), { tomatoBeforeCancel, afterCancel });

  const reversals = await prisma.stockMovement.count({ where: { referenceType: "PRODUCTION_CANCELLED", referenceId: doomedId } });
  check("the return is a new movement, not a deleted one", reversals > 0, reversals);

  // ================= LEDGER INTEGRITY =================
  const rebuild = await api("/admin/stock/rebuild", { method: "POST", token: adminToken, body: {} });
  const ourDrift = (rebuild.body?.data?.drift ?? []).filter((row) => row.locationId === storeId);
  check("replaying the ledger reproduces every cached level", ourDrift.length === 0, ourDrift);

  const batchSum = await prisma.stockBatch.aggregate({
    where: { itemId: sauceId, locationId: storeId },
    _sum: { remainingQuantity: true },
  });
  check("batch remainders still add up to the level", round(num(batchSum._sum.remainingQuantity)) === round(await levelOf(sauceId, storeId)), batchSum);

  // ================= VARIANCE REPORT =================
  const varianceReport = await api(`/admin/production-orders/variance?branchId=${branchId}`, { token: adminToken });
  check("the variance report counts only completed runs", varianceReport.body.data.runs.length === 1, varianceReport.body?.data);
  const summary = varianceReport.body.data.summary[0];
  check("runs are summarised by recipe", summary.runs === 1, summary);
  check("the summary carries the overspend", num(summary.variance) === 100, summary);
  check("waste percentage is of everything made", summary.wastePercent === 10, summary);

  const listed = await api(`/admin/production-orders?branchId=${branchId}`, { token: adminToken });
  check("runs are listed with their variance", listed.body.data.items.length === 3, listed.body?.data);

  // ================= MODIFIER INGREDIENTS =================
  const extras = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Extras ${stamp}`,
      selectionType: "MULTIPLE",
      minSelect: 0,
      maxSelect: 2,
      allowQuantity: true,
      options: [{ name: "Extra cheese", priceDelta: 150 }],
    },
  });
  const groupId = extras.body.data.id;
  const optionId = extras.body.data.options[0].id;

  const badUnit = await api(`/admin/modifier-groups/${groupId}/options/${optionId}/ingredients`, {
    method: "POST",
    token: adminToken,
    body: { itemId: cheeseId, quantity: 30, uomId: mlId },
  });
  check("a modifier ingredient in the wrong kind of unit is refused", badUnit.status === 400, badUnit.body?.error);

  const addIngredient = await api(`/admin/modifier-groups/${groupId}/options/${optionId}/ingredients`, {
    method: "POST",
    token: adminToken,
    body: { itemId: cheeseId, quantity: 30, uomId: gId },
  });
  check("an add-on can be told what it costs the store room", addIngredient.status === 201, addIngredient.body);

  const corrected = await api(`/admin/modifier-groups/${groupId}/options/${optionId}/ingredients`, {
    method: "POST",
    token: adminToken,
    body: { itemId: cheeseId, quantity: 40, uomId: gId },
  });
  check("posting the same ingredient again corrects it rather than duplicating", num(corrected.body.data.quantity) === 40, corrected.body?.data);

  const ingredientList = await api(`/admin/modifier-groups/${groupId}/options/${optionId}/ingredients`, { token: adminToken });
  check("one ingredient line, not two", ingredientList.body.data.length === 1, ingredientList.body?.data);
  check("the stocking-unit quantity is shown next to what was typed", num(ingredientList.body.data[0].stockingQuantity) === 0.04, ingredientList.body?.data);

  const modifierCosts = await api(`/admin/modifier-groups/cost-report?groupId=${groupId}`, { token: adminToken });
  const cheeseRow = modifierCosts.body.data.find((row) => row.optionId === optionId);
  // 40 g of cheese at 1200 per kg is 48, against a 150 price delta.
  check("an add-on is costed from its ingredients", num(cheeseRow.cost) === 48, cheeseRow);
  check("the margin on an add-on is price less cost", num(cheeseRow.margin) === 102, cheeseRow);

  const removed = await api(`/admin/modifier-groups/${groupId}/options/${optionId}/ingredients/${cheeseId}`, {
    method: "DELETE",
    token: adminToken,
  });
  check("a modifier ingredient can be removed", removed.status === 200, removed.body);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const locations = await prisma.stockLocation.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const locationIds = locations.map((l) => l.id);
  const items = await prisma.inventoryItem.findMany({
    where: { name: { contains: String(stamp) } },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);
  const runs = await prisma.productionOrder.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const runIds = runs.map((r) => r.id);

  await prisma.productionConsumption.deleteMany({ where: { productionOrderId: { in: runIds } } });
  await prisma.productionOutput.deleteMany({ where: { productionOrderId: { in: runIds } } });
  await prisma.wastage.deleteMany({ where: { OR: [{ productionOrderId: { in: runIds } }, { locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockMovement.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockBatch.deleteMany({ where: { OR: [{ productionOrderId: { in: runIds } }, { locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.productionOrder.deleteMany({ where: { id: { in: runIds } } });

  await prisma.modifierOptionIngredient.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.recipeIngredient.deleteMany({ where: { recipe: { name: { contains: String(stamp) } } } });
  await prisma.recipe.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.stockLevel.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { branchId: { in: branchIds } } } });
  await prisma.goodsReceipt.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.stockLocation.deleteMany({ where: { branchId: { in: branchIds } } });

  await prisma.supplierItem.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.supplier.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.inventoryCategory.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.unitOfMeasure.deleteMany({ where: { id: { in: [...created.unitIds].filter(Boolean) } } });

  await prisma.modifierOption.deleteMany({ where: { group: { name: { contains: String(stamp) } } } });
  await prisma.modifierGroup.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.productVariant.deleteMany({ where: { product: { slug: { contains: String(stamp) } } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });

  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2EA" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    items: await prisma.inventoryItem.count(),
    locations: await prisma.stockLocation.count(),
    levels: await prisma.stockLevel.count(),
    movements: await prisma.stockMovement.count(),
    batches: await prisma.stockBatch.count(),
    recipes: await prisma.recipe.count(),
    productionOrders: await prisma.productionOrder.count(),
    wastage: await prisma.wastage.count(),
    products: await prisma.product.count(),
    modifierGroups: await prisma.modifierGroup.count(),
    units: await prisma.unitOfMeasure.count(),
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
