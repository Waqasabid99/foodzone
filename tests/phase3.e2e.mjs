import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 3 — Catalog & Menu, end to end over HTTP.
 *
 * Start a server first:  APP_URL=http://localhost:3100 npx next dev -p 3100
 *
 * Everything created here is namespaced with a timestamp and removed in
 * `cleanup()`, which then asserts the database is back to its seeded baseline.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e3-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E3${String(stamp).slice(-5)}`;
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
const nextIp = () => `10.30.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

/** The CSV endpoints return a file, not the JSON envelope. */
async function apiText(pathname, { token, ip } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    headers: {
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
}

/** Replaces one cell in a CSV, the way a person edits one price in a spreadsheet. */
function editCsvCell(csv, { keyColumn, keyValue, column, value }) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].replace(/^\ufeff/, "").split(",");
  const keyIndex = headers.indexOf(keyColumn);
  const columnIndex = headers.indexOf(column);

  return lines
    .map((line, index) => {
      if (index === 0) return line;
      const cells = line.split(",");
      if (cells[keyIndex] !== keyValue) return line;
      cells[columnIndex] = value;
      return cells.join(",");
    })
    .join("\r\n");
}

/** The branch's local weekday and minutes, so windows can be built to match now. */
function localNow(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dayOfWeek: days[value("weekday")],
    minutes: (Number(value("hour")) % 24) * 60 + Number(value("minute")),
  };
}

async function main() {
  // ---- actors -------------------------------------------------------------
  const cust = await api("/auth/register", {
    method: "POST",
    body: { name: "P3 Customer", email: emailOf("cust"), password: "customer-passphrase" },
  });
  created.userIds.add(cust.body.data.user.id);
  const custToken = cust.body.data.accessToken;

  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P3 Admin", email: emailOf("admin"), password: "admin-passphrase-3" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminLogin = await api("/auth/login", {
    method: "POST",
    body: { email: emailOf("admin"), password: "admin-passphrase-3" },
  });
  const adminToken = adminLogin.body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P3 Branch", city: "Lahore", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);
  check("test branch is created", branch.status === 201, branch.body);

  // ===================== CATEGORIES =====================
  const denied = await api("/admin/categories", { method: "POST", token: custToken, body: { name: "Nope" } });
  check("a customer cannot create a category", denied.status === 403, denied.body?.error);

  const anon = await api("/admin/categories");
  check("the admin category list requires auth", anon.status === 401, anon.body?.error);

  const food = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Food ${stamp}`, description: "Everything hot" },
  });
  check("a category is created with a slug", food.status === 201 && !!food.body?.data?.slug, food.body);
  const foodId = food.body.data.id;

  const dupe = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `Food ${stamp}` } });
  check("a duplicate name gets a distinct slug, not a 409", dupe.status === 201 && dupe.body.data.slug !== food.body.data.slug, {
    a: food.body.data.slug,
    b: dupe.body?.data?.slug,
  });
  const dupeId = dupe.body.data.id;

  const pizza = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Pizza ${stamp}`, parentId: foodId },
  });
  check("a child category is created", pizza.status === 201 && pizza.body.data.parentId === foodId, pizza.body);
  const pizzaId = pizza.body.data.id;

  const cycle = await api(`/admin/categories/${foodId}`, {
    method: "PATCH",
    token: adminToken,
    body: { parentId: pizzaId },
  });
  check("a category cannot be moved beneath its own child", cycle.status === 400, cycle.body?.error);

  const selfParent = await api(`/admin/categories/${foodId}`, {
    method: "PATCH",
    token: adminToken,
    body: { parentId: foodId },
  });
  check("a category cannot be its own parent", selfParent.status === 400, selfParent.body?.error);

  const missingParent = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Ghost ${stamp}`, parentId: "does-not-exist" },
  });
  check("an unknown parent is rejected", missingParent.status === 400, missingParent.body?.error);

  const tree = await api("/admin/categories?tree=true", { token: adminToken });
  const foodNode = tree.body.data.find((row) => row.id === foodId);
  check("the tree nests children under their parent", foodNode?.children?.some((c) => c.id === pizzaId), foodNode);

  const reorder = await api("/admin/categories/reorder", {
    method: "PUT",
    token: adminToken,
    body: { items: [{ id: foodId, sortOrder: 5 }, { id: pizzaId, sortOrder: 1 }] },
  });
  check("categories can be reordered in bulk", reorder.status === 200 && reorder.body.data.updated === 2, reorder.body);

  const deleteParent = await api(`/admin/categories/${foodId}`, { method: "DELETE", token: adminToken });
  check("a category with children cannot be deleted", deleteParent.status === 409, deleteParent.body?.error);

  const deleteSpare = await api(`/admin/categories/${dupeId}`, { method: "DELETE", token: adminToken });
  check("an empty category can be deleted", deleteSpare.status === 200, deleteSpare.body);

  // ===================== KITCHEN STATIONS =====================
  const station = await api("/admin/kitchen-stations", {
    method: "POST",
    token: adminToken,
    body: { name: "Hot line", code: `hot${String(stamp).slice(-5)}` },
  });
  check("a kitchen station is created with an uppercased code", station.status === 201 && station.body.data.code === `HOT${String(stamp).slice(-5)}`, station.body);
  const stationId = station.body.data.id;

  const dupeStation = await api("/admin/kitchen-stations", {
    method: "POST",
    token: adminToken,
    body: { name: "Clash", code: `HOT${String(stamp).slice(-5)}` },
  });
  check("a duplicate station code is 409", dupeStation.status === 409, dupeStation.body?.error);

  // ===================== PRODUCTS =====================
  const noPrice = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Priceless ${stamp}`, categoryId: pizzaId },
  });
  check("a product without a price or variants is rejected", noPrice.status === 400, noPrice.body?.error);

  const badCategory = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Orphan ${stamp}`, categoryId: "nope", price: 100 },
  });
  check("a product in an unknown category is rejected", badCategory.status === 400, badCategory.body?.error);

  const fries = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Fries ${stamp}`,
      categoryId: pizzaId,
      price: 250,
      shortDescription: "Crispy",
      stationId,
      dietary: ["VEG"],
    },
  });
  check("a simple product is created", fries.status === 201, fries.body);
  // Publishing is a separate permission, so creating must never publish —
  // otherwise `products.create` alone would put items in front of customers.
  check("a new product is created unpublished", fries.body?.data?.isActive === false, fries.body?.data?.isActive);
  check("a simple product gets one default variant automatically", fries.body?.data?.variants?.length === 1 && fries.body.data.variants[0].isDefault === true, fries.body?.data?.variants);
  check("the auto variant carries the price and a generated SKU", Number(fries.body?.data?.variants?.[0]?.price) === 250 && !!fries.body.data.variants[0].sku, fries.body?.data?.variants?.[0]);
  check("priceFrom is derived for the client", fries.body?.data?.priceFrom === 250, fries.body?.data?.priceFrom);
  const friesId = fries.body.data.id;
  const friesSlug = fries.body.data.slug;

  const margherita = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Margherita ${stamp}`,
      categoryId: pizzaId,
      type: "VARIANT",
      description: "Tomato, mozzarella, basil",
      variants: [
        { name: "Small", price: 800, sortOrder: 0 },
        { name: "Large", price: 1400, isDefault: true, sortOrder: 1 },
      ],
    },
  });
  check("a multi-variant product is created", margherita.status === 201 && margherita.body.data.variants.length === 2, margherita.body);
  check("the marked variant is the default", margherita.body?.data?.defaultVariant?.name === "Large", margherita.body?.data?.defaultVariant);
  check("priceFrom is the cheapest variant", margherita.body?.data?.priceFrom === 800, margherita.body?.data?.priceFrom);
  const pizzaProductId = margherita.body.data.id;
  const smallId = margherita.body.data.variants.find((v) => v.name === "Small").id;
  const largeId = margherita.body.data.variants.find((v) => v.name === "Large").id;

  const dupeVariantNames = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Twins ${stamp}`,
      categoryId: pizzaId,
      variants: [{ name: "Same", price: 1 }, { name: "same", price: 2 }],
    },
  });
  check("two variants cannot share a name", dupeVariantNames.status === 400, dupeVariantNames.body?.error);

  const promoted = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Auto ${stamp}`, categoryId: pizzaId, variants: [{ name: "A", price: 10 }, { name: "B", price: 20 }] },
  });
  check("a SIMPLE product with several variants is promoted to VARIANT", promoted.body?.data?.type === "VARIANT", promoted.body?.data?.type);
  check("an unmarked variant set still gets exactly one default", promoted.body?.data?.variants?.filter((v) => v.isDefault).length === 1, promoted.body?.data?.variants);
  const autoId = promoted.body.data.id;

  // --- publishing is its own permission -----------------------------------
  const published = await api(`/admin/products/${friesId}/publish`, {
    method: "PUT",
    token: adminToken,
    body: { isActive: true },
  });
  check("a product can be published", published.status === 200 && published.body.data.isActive === true, published.body);
  for (const id of [pizzaProductId, autoId]) {
    await api(`/admin/products/${id}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });
  }

  const search = await api(`/admin/products?search=Margherita ${stamp}`, { token: adminToken });
  check("admin product search finds by name", search.body?.data?.some((p) => p.id === pizzaProductId), search.body?.data?.length);

  const filtered = await api(`/admin/products?categoryId=${pizzaId}&isActive=true`, { token: adminToken });
  check("admin products filter by category and status", filtered.status === 200 && filtered.body.data.length >= 3, filtered.body?.data?.length);

  // ===================== VARIANTS =====================
  const medium = await api(`/admin/products/${pizzaProductId}/variants`, {
    method: "POST",
    token: adminToken,
    body: { name: "Medium", price: 1100 },
  });
  check("a variant can be added", medium.status === 201 && !!medium.body.data.sku, medium.body);
  const mediumId = medium.body.data.id;

  const dupeVariant = await api(`/admin/products/${pizzaProductId}/variants`, {
    method: "POST",
    token: adminToken,
    body: { name: "medium", price: 1200 },
  });
  check("a duplicate variant name is 409", dupeVariant.status === 409, dupeVariant.body?.error);

  const newDefault = await api(`/admin/products/${pizzaProductId}/variants/${smallId}`, {
    method: "PATCH",
    token: adminToken,
    body: { isDefault: true },
  });
  check("setting a new default succeeds", newDefault.status === 200 && newDefault.body.data.isDefault === true, newDefault.body);

  const afterSwap = await api(`/admin/products/${pizzaProductId}/variants`, { token: adminToken });
  check("exactly one variant remains the default", afterSwap.body.data.filter((v) => v.isDefault).length === 1, afterSwap.body?.data);

  const clearDefault = await api(`/admin/products/${pizzaProductId}/variants/${smallId}`, {
    method: "PATCH",
    token: adminToken,
    body: { isDefault: false },
  });
  check("the default cannot simply be cleared", clearDefault.status === 400, clearDefault.body?.error);

  const lastVariant = await api(`/admin/products/${friesId}/variants`, { token: adminToken });
  const onlyFryVariant = lastVariant.body.data[0].id;
  const deactivateLast = await api(`/admin/products/${friesId}/variants/${onlyFryVariant}`, {
    method: "PATCH",
    token: adminToken,
    body: { isActive: false },
  });
  check("the last active variant cannot be deactivated", deactivateLast.status === 409, deactivateLast.body?.error);

  const deleteLast = await api(`/admin/products/${friesId}/variants/${onlyFryVariant}`, {
    method: "DELETE",
    token: adminToken,
  });
  check("the last variant cannot be deleted", deleteLast.status === 409, deleteLast.body?.error);

  const deleteMedium = await api(`/admin/products/${pizzaProductId}/variants/${mediumId}`, {
    method: "DELETE",
    token: adminToken,
  });
  check("a spare variant can be deleted", deleteMedium.status === 200, deleteMedium.body);

  // ===================== MODIFIERS =====================
  const impossible = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: { name: "Impossible", selectionType: "SINGLE", minSelect: 0, maxSelect: 3 },
  });
  check("a single-choice group cannot allow several selections", impossible.status === 400, impossible.body?.error);

  const tooFew = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Too few",
      selectionType: "MULTIPLE",
      minSelect: 3,
      maxSelect: 4,
      options: [{ name: "One", priceDelta: 0 }],
    },
  });
  check("a group cannot demand more choices than it offers", tooFew.status === 400, tooFew.body?.error);

  const extras = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Extras ${stamp}`,
      internalName: `extras-${stamp}`,
      selectionType: "MULTIPLE",
      minSelect: 0,
      maxSelect: 3,
      options: [
        { name: "Extra cheese", priceDelta: 150 },
        { name: "Olives", priceDelta: 100 },
        { name: "No onion", priceDelta: 0 },
      ],
    },
  });
  check("a modifier group is created with its options", extras.status === 201 && extras.body.data.options.length === 3, extras.body);
  const extrasId = extras.body.data.id;

  const crust = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Crust ${stamp}`,
      selectionType: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      options: [{ name: "Thin", priceDelta: 0, isDefault: true }, { name: "Thick", priceDelta: 200 }],
    },
  });
  const crustId = crust.body.data.id;
  check("a single-choice group with a default option is created", crust.status === 201, crust.body);

  const newOption = await api(`/admin/modifier-groups/${extrasId}/options`, {
    method: "POST",
    token: adminToken,
    body: { name: "Jalapenos", priceDelta: 120 },
  });
  check("an option can be added to a group", newOption.status === 201, newOption.body);
  const jalapenoId = newOption.body.data.id;

  const dupeOption = await api(`/admin/modifier-groups/${extrasId}/options`, {
    method: "POST",
    token: adminToken,
    body: { name: "jalapenos", priceDelta: 130 },
  });
  check("a duplicate option name is 409", dupeOption.status === 409, dupeOption.body?.error);

  const negative = await api(`/admin/modifier-groups/${extrasId}/options/${jalapenoId}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceDelta: -50 },
  });
  check("a negative price delta is allowed (discounted removals)", negative.status === 200 && Number(negative.body.data.priceDelta) === -50, negative.body);

  const attach = await api(`/admin/products/${pizzaProductId}/modifier-groups`, {
    method: "POST",
    token: adminToken,
    body: { groupId: extrasId, maxSelect: 2 },
  });
  check("a group can be attached to a product with an override", attach.status === 201, attach.body);
  const attached = attach.body.data.find((g) => g.id === extrasId);
  check("the product override wins over the group's own rule", attached?.maxSelect === 2, attached);

  const attachAgain = await api(`/admin/products/${pizzaProductId}/modifier-groups`, {
    method: "POST",
    token: adminToken,
    body: { groupId: extrasId },
  });
  check("attaching the same group twice is 409", attachAgain.status === 409, attachAgain.body?.error);

  const attachRequired = await api(`/admin/products/${pizzaProductId}/modifier-groups`, {
    method: "POST",
    token: adminToken,
    body: { groupId: crustId, isRequired: true },
  });
  const requiredGroup = attachRequired.body?.data?.find((g) => g.id === crustId);
  check("a required group is given a minimum of at least one", requiredGroup?.minSelect >= 1, requiredGroup);

  const deleteAttached = await api(`/admin/modifier-groups/${extrasId}`, { method: "DELETE", token: adminToken });
  check("a group attached to a product cannot be deleted", deleteAttached.status === 409, deleteAttached.body?.error);

  // ===================== COMBOS =====================
  const notACombo = await api(`/admin/products/${pizzaProductId}/combo-groups`, {
    method: "POST",
    token: adminToken,
    body: { name: "Pick a side" },
  });
  check("combo groups are refused on a non-combo product", notACombo.status === 400, notACombo.body?.error);

  const comboProduct = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Meal deal ${stamp}`, categoryId: pizzaId, type: "COMBO", price: 1600 },
  });
  check("a combo product is created", comboProduct.status === 201 && comboProduct.body.data.type === "COMBO", comboProduct.body);
  const comboId = comboProduct.body.data.id;
  await api(`/admin/products/${comboId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const comboGroup = await api(`/admin/products/${comboId}/combo-groups`, {
    method: "POST",
    token: adminToken,
    body: {
      name: "Pick a pizza",
      minSelect: 1,
      maxSelect: 1,
      options: [{ productId: pizzaProductId, variantId: largeId, priceDelta: 200 }, { productId: friesId }],
    },
  });
  check("a combo group is created with its options", comboGroup.status === 201 && comboGroup.body.data.options.length === 2, comboGroup.body);
  const comboGroupId = comboGroup.body.data.id;

  const resolvedOption = comboGroup.body.data.options.find((o) => o.product.id === friesId);
  check("an option without a variant resolves to the product's default", !!resolvedOption?.variantId, resolvedOption);

  const selfCombo = await api(`/admin/products/${comboId}/combo-groups/${comboGroupId}/options`, {
    method: "POST",
    token: adminToken,
    body: { productId: comboId },
  });
  check("a combo cannot contain itself", selfCombo.status === 400, selfCombo.body?.error);

  const otherCombo = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Other deal ${stamp}`, categoryId: pizzaId, type: "COMBO", price: 100 },
  });
  const otherComboId = otherCombo.body.data.id;
  const nested = await api(`/admin/products/${comboId}/combo-groups/${comboGroupId}/options`, {
    method: "POST",
    token: adminToken,
    body: { productId: otherComboId },
  });
  check("a combo cannot contain another combo", nested.status === 400, nested.body?.error);

  const dupeComboOption = await api(`/admin/products/${comboId}/combo-groups/${comboGroupId}/options`, {
    method: "POST",
    token: adminToken,
    body: { productId: pizzaProductId, variantId: largeId },
  });
  check("the same combo choice cannot be added twice", dupeComboOption.status === 409, dupeComboOption.body?.error);

  const addSmall = await api(`/admin/products/${comboId}/combo-groups/${comboGroupId}/options`, {
    method: "POST",
    token: adminToken,
    body: { productId: pizzaProductId, variantId: smallId },
  });
  check("a different variant of the same product is a distinct choice", addSmall.status === 201, addSmall.body);

  const impossibleCombo = await api(`/admin/products/${comboId}/combo-groups/${comboGroupId}`, {
    method: "PATCH",
    token: adminToken,
    body: { minSelect: 9 },
  });
  check("a combo group cannot demand more picks than it offers", impossibleCombo.status === 400, impossibleCombo.body?.error);

  // ===================== MENUS =====================
  const badWindow = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Broken", type: "DINE_IN", startMinute: 900 },
  });
  check("a half-defined time window is rejected", badWindow.status === 400, badWindow.body?.error);

  const backwards = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Backwards", type: "DINE_IN", startMinute: 900, endMinute: 600 },
  });
  check("a window that ends before it starts is rejected", backwards.status === 400, backwards.body?.error);

  const allDay = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `All day ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  check("a menu is created", allDay.status === 201 && allDay.body.data.isDefault === true, allDay.body);
  const allDayId = allDay.body.data.id;

  const secondDefault = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Also default ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  const secondDefaultId = secondDefault.body.data.id;
  const firstAfter = await api(`/admin/menus/${allDayId}`, { token: adminToken });
  check("only one menu per branch and type stays default", firstAfter.body.data.isDefault === false, firstAfter.body?.data);

  const deliveryMenu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Delivery ${stamp}`, type: "DELIVERY", isDefault: true },
  });
  const deliveryId = deliveryMenu.body.data.id;
  check("a menu of another type keeps its own default", deliveryMenu.body?.data?.isDefault === true, deliveryMenu.body);

  // --- sections ------------------------------------------------------------
  const section = await api(`/admin/menus/${secondDefaultId}/sections`, {
    method: "POST",
    token: adminToken,
    body: { name: "Mains" },
  });
  check("a menu section is created", section.status === 201, section.body);
  const sectionId = section.body.data.id;

  const foreignSection = await api(`/admin/menus/${deliveryId}/sections/${sectionId}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: "Hijack" },
  });
  check("a section cannot be edited through another menu", foreignSection.status === 404, foreignSection.body?.error);

  // --- items ---------------------------------------------------------------
  const addAllVariants = await api(`/admin/menus/${secondDefaultId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: pizzaProductId, sectionId },
  });
  check("adding a product adds one row per active variant", addAllVariants.status === 201 && addAllVariants.body.data.length === 2, addAllVariants.body?.data?.length);
  const pizzaItems = addAllVariants.body.data;
  const largeItem = pizzaItems.find((item) => item.variantId === largeId);

  const addAgain = await api(`/admin/menus/${secondDefaultId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: pizzaProductId },
  });
  check("re-adding the same variants is 409", addAgain.status === 409, addAgain.body?.error);

  const addFries = await api(`/admin/menus/${secondDefaultId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: friesId, sectionId },
  });
  check("a single-variant product adds one row", addFries.status === 201 && addFries.body.data.length === 1, addFries.body);
  const friesItemId = addFries.body.data[0].id;

  const addCombo = await api(`/admin/menus/${secondDefaultId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: comboId, sectionId },
  });
  check("a combo goes on a menu like any other product", addCombo.status === 201, addCombo.body);

  const foreignSectionItem = await api(`/admin/menus/${deliveryId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: friesId, sectionId },
  });
  check("an item cannot be filed under another menu's section", foreignSectionItem.status === 400, foreignSectionItem.body?.error);

  const override = await api(`/admin/menus/${secondDefaultId}/items/${largeItem.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceOverride: 1600 },
  });
  check("a menu price override applies", override.status === 200 && override.body.data.price === 1600, override.body?.data);
  check("the base price is still reported alongside", override.body?.data?.basePrice === 1400, override.body?.data);

  // Delivery pricing: the same variant, priced differently on another menu.
  await api(`/admin/menus/${deliveryId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: pizzaProductId, variantId: largeId, priceOverride: 1750 },
  });
  const deliveryItems = await api(`/admin/menus/${deliveryId}/items`, { token: adminToken });
  check("the same variant can carry a different price per menu", deliveryItems.body?.data?.[0]?.price === 1750, deliveryItems.body?.data);

  // --- the 86 switch -------------------------------------------------------
  const eightySix = await api(`/admin/menus/${secondDefaultId}/items/${friesItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: false },
  });
  check("an item can be 86'd", eightySix.status === 200 && eightySix.body.data.available === false, eightySix.body?.data);

  const pastDeadline = await api(`/admin/menus/${secondDefaultId}/items/${friesItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: false, until: new Date(Date.now() - 60_000).toISOString() },
  });
  check("a deadline in the past is rejected", pastDeadline.status === 400, pastDeadline.body?.error);

  const timed = await api(`/admin/menus/${secondDefaultId}/items/${friesItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: false, until: new Date(Date.now() + 3600_000).toISOString() },
  });
  check("a timed 86 is accepted", timed.status === 200 && timed.body.data.available === false, timed.body?.data);

  // An expired deadline must self-heal at read time, without waiting for the job.
  await prisma.menuItem.update({
    where: { id: friesItemId },
    data: { unavailableUntil: new Date(Date.now() - 60_000) },
  });
  const expired = await api(`/admin/menus/${secondDefaultId}/items?limit=200`, { token: adminToken });
  const expiredItem = expired.body.data.find((item) => item.id === friesItemId);
  check("an expired 86 reads as available before the sweep runs", expiredItem?.available === true, expiredItem);

  const backOn = await api(`/admin/menus/${secondDefaultId}/items/${friesItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: true },
  });
  check("turning an item back on clears its deadline", backOn.body?.data?.unavailableUntil === null, backOn.body?.data);

  const withDeadline = await api(`/admin/menus/${secondDefaultId}/items/${friesItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: true, until: new Date(Date.now() + 3600_000).toISOString() },
  });
  check("a deadline cannot be set while marking an item available", withDeadline.status === 400, withDeadline.body?.error);

  // ===================== PUBLIC CATALOG =====================
  const publicCats = await api("/categories?tree=true");
  check("public categories need no auth", publicCats.status === 200, publicCats.body?.error);
  const publicFood = publicCats.body.data.find((row) => row.id === foodId);
  check("public categories carry a published-product count", typeof publicFood?.productCount === "number", publicFood);

  const publicList = await api(`/products?search=Margherita ${stamp}`);
  check("public product search works without auth", publicList.status === 200 && publicList.body.data.some((p) => p.id === pizzaProductId), publicList.body?.data?.length);
  check("the public payload omits internal fields", publicList.body?.data?.[0] && !("deletedAt" in publicList.body.data[0]) && !("stationId" in publicList.body.data[0]), Object.keys(publicList.body?.data?.[0] ?? {}));

  const detail = await api(`/products/${margherita.body.data.slug}`);
  check("a public product page resolves by slug", detail.status === 200 && detail.body.data.id === pizzaProductId, detail.body);
  check("the product page carries its modifier groups", detail.body?.data?.modifierGroups?.length === 2, detail.body?.data?.modifierGroups?.length);
  const publicExtras = detail.body?.data?.modifierGroups?.find((g) => g.id === extrasId);
  check("the effective (overridden) rule is what the client sees", publicExtras?.maxSelect === 2, publicExtras);

  const comboDetail = await api(`/products/${comboProduct.body.data.slug}`);
  check("a combo page carries its slots and choices", comboDetail.body?.data?.comboGroups?.[0]?.options?.length === 3, comboDetail.body?.data?.comboGroups);

  const searchAll = await api(`/search?q=Margherita ${stamp}`);
  check("catalog search returns products and categories", searchAll.status === 200 && Array.isArray(searchAll.body.data.products) && Array.isArray(searchAll.body.data.categories), searchAll.body?.data);

  const shortQuery = await api("/search?q=a");
  check("a one-character search is rejected", shortQuery.status === 400, shortQuery.body?.error);

  const unpublished = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Secret ${stamp}`, categoryId: pizzaId, price: 500 },
  });
  const secretId = unpublished.body.data.id;
  const secretPublic = await api(`/products/${unpublished.body.data.slug}`);
  check("an unpublished product is invisible publicly", secretPublic.status === 404, secretPublic.body);

  // ===================== BRANCH MENU (the storefront read model) =====================
  const menuNow = await api(`/branches/${branchId}/menu?type=DINE_IN`);
  check("the branch menu resolves without auth", menuNow.status === 200, menuNow.body?.error);
  check("the default menu is chosen when nothing is scheduled", menuNow.body?.data?.menu?.id === secondDefaultId, menuNow.body?.data?.menu);
  check("sections come back with their products", menuNow.body?.data?.sections?.[0]?.products?.length >= 1, menuNow.body?.data?.sections);

  const pizzaCard = menuNow.body.data.sections.flatMap((s) => s.products).find((p) => p.productId === pizzaProductId);
  check("variants are collapsed onto one product card", pizzaCard?.variants?.length === 2, pizzaCard);
  check("the card's priceFrom uses the menu price, not the base price", pizzaCard?.priceFrom === 800, pizzaCard?.priceFrom);
  check("the overridden variant shows the menu price", pizzaCard?.variants?.find((v) => v.variantId === largeId)?.price === 1600, pizzaCard?.variants);

  const menuByCode = await api(`/branches/${BRANCH_CODE}/menu?type=DINE_IN`);
  check("the branch menu is reachable by branch code", menuByCode.body?.data?.menu?.id === secondDefaultId, menuByCode.body?.data?.menu);

  // A lunch menu covering right now must beat the all-day default.
  const local = localNow("Asia/Karachi");
  const lunch = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      name: `Lunch ${stamp}`,
      type: "DINE_IN",
      startMinute: Math.max(0, local.minutes - 30),
      endMinute: Math.min(1439, local.minutes + 30),
      daysOfWeek: [local.dayOfWeek],
    },
  });
  const lunchId = lunch.body.data.id;
  await api(`/admin/menus/${lunchId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: friesId },
  });

  const duringLunch = await api(`/branches/${branchId}/menu?type=DINE_IN`);
  check("a scheduled menu takes over from the default during its window", duringLunch.body?.data?.menu?.id === lunchId, duringLunch.body?.data?.menu);

  const previewLater = await api(`/branches/${branchId}/menu?type=DINE_IN&at=${encodeURIComponent(new Date(Date.now() + 4 * 3600_000).toISOString())}`);
  check("staff can preview another moment and see the default return", previewLater.body?.data?.menu?.id === secondDefaultId, previewLater.body?.data?.menu);

  const explicitMenu = await api(`/branches/${branchId}/menu?menu=${allDay.body.data.slug}`);
  check("a menu can be requested explicitly by slug", explicitMenu.body?.data?.menu?.id === allDayId, explicitMenu.body?.data?.menu);

  // 86 on the lunch menu hides the item from customers but not from staff.
  const lunchItems = await api(`/admin/menus/${lunchId}/items`, { token: adminToken });
  const lunchFries = lunchItems.body.data[0].id;
  await api(`/admin/menus/${lunchId}/items/${lunchFries}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: false },
  });

  const customerView = await api(`/branches/${branchId}/menu?type=DINE_IN`);
  const stillThere = customerView.body.data.sections.flatMap((s) => s.products).some((p) => p.productId === friesId);
  check("an 86'd item disappears from the customer's menu", stillThere === false, customerView.body?.data?.sections);

  const staffView = await api(`/branches/${branchId}/menu?type=DINE_IN&includeUnavailable=true`);
  const shownSoldOut = staffView.body.data.sections
    .flatMap((s) => s.products)
    .find((p) => p.productId === friesId);
  check("staff can still see it, marked unavailable", shownSoldOut?.variants?.[0]?.available === false, shownSoldOut);

  const noMenu = await api(`/branches/${branchId}/menu?type=CATERING`);
  check("a channel with no menu says so rather than 404ing", noMenu.status === 200 && noMenu.body.data.menu === null && noMenu.body.data.reason === "NO_MENU_CONFIGURED", noMenu.body?.data);

  // ===================== SOFT DELETE =====================
  const beforeDelete = await api(`/admin/menus/${secondDefaultId}/items?limit=200`, { token: adminToken });
  const friesOnMenus = beforeDelete.body.data.filter((item) => item.productId === friesId).length;
  check("the product is on the menu before deletion", friesOnMenus === 1, friesOnMenus);

  const softDeleted = await api(`/admin/products/${friesId}`, { method: "DELETE", token: adminToken });
  check("a product is soft-deleted and leaves every menu", softDeleted.status === 200 && softDeleted.body.data.removedFromMenus >= 2, softDeleted.body?.data);

  const goneFromAdmin = await api(`/admin/products/${friesId}`, { token: adminToken });
  check("a deleted product 404s by default", goneFromAdmin.status === 404, goneFromAdmin.body);

  const stillInDb = await api(`/admin/products/${friesId}?includeDeleted=true`, { token: adminToken });
  check("a deleted product is still readable for reporting", stillInDb.status === 200 && !!stillInDb.body.data.deletedAt, stillInDb.body?.data?.deletedAt);

  const goneFromPublic = await api(`/products/${friesSlug}`);
  check("a deleted product is invisible publicly", goneFromPublic.status === 404, goneFromPublic.body);

  const restored = await api(`/admin/products/${friesId}/restore`, { method: "POST", token: adminToken });
  check("a product can be restored", restored.status === 200 && restored.body.data.deletedAt === null, restored.body?.data);
  check("a restored product comes back unpublished", restored.body?.data?.isActive === false, restored.body?.data?.isActive);

  const deleteBusyCategory = await api(`/admin/categories/${pizzaId}`, { method: "DELETE", token: adminToken });
  check("a category holding products cannot be deleted", deleteBusyCategory.status === 409, deleteBusyCategory.body?.error);

  const deleteBusyStation = await api(`/admin/kitchen-stations/${stationId}`, { method: "DELETE", token: adminToken });
  check("deleting a station unroutes its products rather than failing", deleteBusyStation.status === 200, deleteBusyStation.body);

  // ===================== PERMISSION BOUNDARIES =====================
  const custMenu = await api(`/admin/menus/${secondDefaultId}/items/${largeItem.id}`, {
    method: "PATCH",
    token: custToken,
    body: { priceOverride: 1 },
  });
  check("a customer cannot reprice a menu item", custMenu.status === 403, custMenu.body?.error);

  const custPublish = await api(`/admin/products/${pizzaProductId}/publish`, {
    method: "PUT",
    token: custToken,
    body: { isActive: false },
  });
  check("a customer cannot publish a product", custPublish.status === 403, custPublish.body?.error);

  // ===================== MENU CLONING =====================
  const branchTwo = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `${BRANCH_CODE}B`, name: "P3 Branch Two", city: "Lahore", timezone: "Asia/Karachi" },
  });
  const branchTwoId = branchTwo.body.data.id;
  created.branchIds.add(branchTwoId);

  const sourceSections = await api(`/admin/menus/${secondDefaultId}/sections`, { token: adminToken });
  const sourceItems = await api(`/admin/menus/${secondDefaultId}/items`, { token: adminToken });
  const sourceSectionCount = sourceSections.body.data.length;
  const sourceItemCount = sourceItems.body.data.length;

  // 86 one item on the source, so the clone can be checked for not inheriting it.
  await api(`/admin/menus/${secondDefaultId}/items/${friesItemId}`, {
    method: "PATCH",
    token: adminToken,
    body: { isAvailable: false },
  });

  const custClone = await api(`/admin/menus/${secondDefaultId}/clone`, {
    method: "POST",
    token: custToken,
    body: { branchId: branchTwoId },
  });
  check("a customer cannot clone a menu", custClone.status === 403, custClone.body?.error);

  const cloned = await api(`/admin/menus/${secondDefaultId}/clone`, {
    method: "POST",
    token: adminToken,
    body: { branchId: branchTwoId },
  });
  check("a menu clones to another branch", cloned.status === 201, cloned.body?.error);
  const clonedId = cloned.body?.data?.id;
  check("the clone is a new menu, not the original", clonedId !== secondDefaultId, clonedId);
  check("the clone belongs to the target branch", cloned.body?.data?.branchId === branchTwoId, cloned.body?.data);

  // Cloning is what you do *before* changing prices; going live immediately is
  // the opposite of the point.
  check("a clone is inactive until someone publishes it", cloned.body?.data?.isActive === false, cloned.body?.data);
  check("a clone does not inherit being the default", cloned.body?.data?.isDefault === false, cloned.body?.data);
  check("the clone reports what it copied", cloned.body?.data?.clonedFrom === secondDefaultId, cloned.body?.data);

  const clonedSections = await api(`/admin/menus/${clonedId}/sections`, { token: adminToken });
  check(
    "sections come across",
    clonedSections.body?.data?.length === sourceSectionCount,
    { got: clonedSections.body?.data?.length, want: sourceSectionCount },
  );

  const clonedItems = await api(`/admin/menus/${clonedId}/items`, { token: adminToken });
  check(
    "every item comes across",
    clonedItems.body?.data?.length === sourceItemCount,
    { got: clonedItems.body?.data?.length, want: sourceItemCount },
  );
  check(
    "items are filed under the copied sections, not the originals",
    clonedItems.body?.data?.every((item) => !item.sectionId || item.sectionId !== sectionId),
    clonedItems.body?.data?.map((item) => item.sectionId),
  );

  // "Sold out here today" is a fact about one branch's fridge, not a property
  // of the menu.
  check(
    "the 86 state is not carried to the other branch",
    clonedItems.body?.data?.every((item) => item.isAvailable === true),
    clonedItems.body?.data?.filter((item) => !item.isAvailable),
  );

  const sameBranch = await api(`/admin/menus/${secondDefaultId}/clone`, { method: "POST", token: adminToken, body: {} });
  check("cloning in place is allowed", sameBranch.status === 201, sameBranch.body?.error);
  check(
    "and names itself so the two can be told apart",
    sameBranch.body?.data?.name?.endsWith("(copy)"),
    sameBranch.body?.data?.name,
  );
  check(
    "with its own slug, since slugs are unique per branch",
    sameBranch.body?.data?.slug !== secondDefault.body.data.slug,
    sameBranch.body?.data?.slug,
  );

  const structureOnly = await api(`/admin/menus/${secondDefaultId}/clone`, {
    method: "POST",
    token: adminToken,
    body: { branchId: branchTwoId, name: `Structure ${stamp}`, includeItems: false },
  });
  const structureItems = await api(`/admin/menus/${structureOnly.body.data.id}/items`, { token: adminToken });
  check("the items can be left behind", structureItems.body?.data?.length === 0, structureItems.body?.data?.length);
  check(
    "while the sections still come across",
    structureOnly.body?.data?.sectionCount === sourceSectionCount,
    structureOnly.body?.data,
  );

  const missingSource = await api(`/admin/menus/${secondDefaultId.slice(0, -4)}zzzz/clone`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("cloning a menu that does not exist is 404", missingSource.status === 404, missingSource.body?.error);

  // ===================== CATALOG EXPORT AND IMPORT =====================
  const pizzaRead = await api(`/admin/products/${pizzaProductId}`, { token: adminToken });
  const pizzaSlug = pizzaRead.body.data.slug;

  const custExport = await apiText("/admin/catalog/export?resource=products", { token: custToken });
  check("a customer cannot export the catalog", custExport.status === 403, custExport.status);

  const exported = await apiText("/admin/catalog/export?resource=products", { token: adminToken });
  check("the catalog exports as CSV", exported.status === 200, exported.status);
  check("as a file, not the JSON envelope", exported.contentType.includes("text/csv"), exported.contentType);
  check("containing the products just created", exported.text.includes(pizzaSlug), exported.text.slice(0, 200));

  const badResource = await apiText("/admin/catalog/export?resource=elephants", { token: adminToken });
  check("an unknown resource is refused", badResource.status === 400, badResource.status);

  // The round trip: importing an untouched export must change nothing.
  const roundTrip = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "products", csv: exported.text },
  });
  check("an untouched export re-imports cleanly", roundTrip.status === 200 && roundTrip.body.data.applied, roundTrip.body);
  check("creating nothing, because every row already exists", roundTrip.body?.data?.created === 0, roundTrip.body?.data);
  check("and updating every row it read", roundTrip.body?.data?.updated === roundTrip.body?.data?.rowsValid, roundTrip.body?.data);

  const priceBefore = await prisma.productVariant.findFirst({
    where: { productId: pizzaProductId, isDefault: true },
    select: { id: true, price: true },
  });

  const repriced = editCsvCell(exported.text, {
    keyColumn: "slug",
    keyValue: pizzaSlug,
    column: "price",
    value: "1575.50",
  });
  const priceImport = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "products", csv: repriced },
  });
  check("a price edited in the spreadsheet imports", priceImport.body?.data?.applied === true, priceImport.body);

  const priceAfter = await prisma.productVariant.findUnique({
    where: { id: priceBefore.id },
    select: { price: true },
  });
  check("and lands exactly, with no float drift", priceAfter.price.toString() === "1575.5", priceAfter.price.toString());

  // A dry run is the intended first step for any file you did not just export.
  const brokenCsv = "slug,name,category_slug,price\r\nvalid-row-" + stamp + ",Valid,pizza-" + stamp + ",100\r\nBAD SLUG,Broken,nope,free\r\n";
  const dry = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "products", csv: brokenCsv, dryRun: true },
  });
  check("a dry run reports without applying", dry.body?.data?.applied === false, dry.body?.data);
  check("naming the spreadsheet line that is wrong", dry.body?.data?.errors?.[0]?.line === 3, dry.body?.data?.errors);
  check(
    "and every problem in that line at once",
    dry.body?.data?.errors?.[0]?.errors?.length === 2,
    dry.body?.data?.errors?.[0],
  );

  const noWrite = await prisma.product.findFirst({ where: { slug: `valid-row-${stamp}` }, select: { id: true } });
  check("a file with any bad row writes nothing at all", noWrite === null, noWrite);

  const missingKey = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "products", csv: "name,category_slug\r\nX,pizza\r\n" },
  });
  check("a file without the key column is refused outright", missingKey.status === 400, missingKey.body?.error);

  const duplicated = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: {
      resource: "categories",
      csv: `slug,name\r\ndup-${stamp},One\r\ndup-${stamp},Two\r\n`,
      dryRun: true,
    },
  });
  check(
    "two rows for the same key is an error, not a silent last-wins",
    duplicated.body?.data?.errors?.[0]?.errors?.[0]?.includes("Duplicate of line 2"),
    duplicated.body?.data?.errors,
  );

  // A child listed above its parent still imports: rows are ordered by depth.
  const importedTree = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: {
      resource: "categories",
      csv:
        `slug,name,parent_slug,description\r\n` +
        `child-${stamp},Child,parent-${stamp},Nested\r\n` +
        `parent-${stamp},Parent,,Top level\r\n`,
    },
  });
  check("a new category tree imports", importedTree.body?.data?.created === 2, importedTree.body);

  const child = await prisma.category.findUnique({
    where: { slug: `child-${stamp}` },
    select: { id: true, description: true, parent: { select: { slug: true } } },
  });
  check("a child listed before its parent still finds it", child?.parent?.slug === `parent-${stamp}`, child);

  const blankLeaves = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "categories", csv: `slug,name,description\r\nchild-${stamp},Renamed,\r\n` },
  });
  check("re-importing updates rather than duplicating", blankLeaves.body?.data?.updated === 1, blankLeaves.body?.data);

  const afterBlank = await prisma.category.findUnique({
    where: { slug: `child-${stamp}` },
    select: { name: true, description: true },
  });
  check("a changed cell is applied", afterBlank?.name === "Renamed", afterBlank);
  check("and a blank cell leaves the old value alone", afterBlank?.description === "Nested", afterBlank);

  await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "categories", csv: `slug,name,description\r\nchild-${stamp},Renamed,--\r\n` },
  });
  const afterClear = await prisma.category.findUnique({
    where: { slug: `child-${stamp}` },
    select: { description: true },
  });
  check("while -- clears it explicitly", afterClear?.description === null, afterClear);

  // Nothing a file omits may be removed: a dropped spreadsheet row must not be
  // able to retire a product that is on a live menu.
  const survived = await prisma.category.findUnique({ where: { slug: `parent-${stamp}` }, select: { id: true } });
  check("a row missing from the file is left alone, never deleted", survived !== null, survived);

  const menuItemCsv =
    `branch_code,menu_slug,product_slug,variant_sku,section_name,price_override\r\n` +
    `${BRANCH_CODE},${allDay.body.data.slug},${friesSlug},,Imported ${stamp},99.25\r\n`;
  const itemImport = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: { resource: "menu-items", csv: menuItemCsv },
  });
  check("menu items import by branch code and menu slug", itemImport.body?.data?.created === 1, itemImport.body);

  const importedItem = await prisma.menuItem.findFirst({
    where: { menu: { id: allDayId }, product: { slug: friesSlug } },
    select: { priceOverride: true, variantId: true, section: { select: { name: true } } },
  });
  check("the price override lands", importedItem?.priceOverride?.toString() === "99.25", importedItem);
  check("a named section is created on the way in", importedItem?.section?.name === `Imported ${stamp}`, importedItem);
  // A NULL variant defeats the unique constraint meant to stop duplicates, so a
  // blank variant_sku must resolve to the product's default rather than stay null.
  check("a blank variant resolves to the product default", Boolean(importedItem?.variantId), importedItem);

  const unknownMenu = await api("/admin/catalog/import", {
    method: "POST",
    token: adminToken,
    body: {
      resource: "menu-items",
      csv: `branch_code,menu_slug,product_slug\r\n${BRANCH_CODE},no-such-menu,${friesSlug}\r\n`,
    },
  });
  check("an item for a menu that does not exist is refused", unknownMenu.status === 400, unknownMenu.body?.error);

  const format = await api("/admin/catalog/format", { token: adminToken });
  check("the column format is published to the UI", format.body?.data?.resources?.length === 4, format.body?.data);

  // Cleanup of ids the sweep needs.
  created.productIds = [friesId, pizzaProductId, autoId, comboId, otherComboId, secretId];
  created.categoryIds = [pizzaId, foodId];
  created.groupIds = [extrasId, crustId];
  created.menuIds = [allDayId, secondDefaultId, deliveryId, lunchId];
  created.stationId = stationId;

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];

  // Menus cascade to sections and items; products cascade to variants, images,
  // modifier attachments and combo groups.
  await prisma.menu.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.modifierGroup.deleteMany({ where: { name: { contains: String(stamp) } } });
  // Children before parents.
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) }, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.kitchenStation.deleteMany({ where: { code: { startsWith: "HOT" } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E3" } } });

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    modifierGroups: await prisma.modifierGroup.count(),
    menus: await prisma.menu.count(),
    menuItems: await prisma.menuItem.count(),
    stations: await prisma.kitchenStation.count(),
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
    leftovers.categories === 0 &&
    leftovers.products === 0 &&
    leftovers.menus === 0 &&
    leftovers.modifierGroups === 0 &&
    leftovers.stations === 0 &&
    leftovers.roles === 20;
  if (!clean) console.log("WARNING: database not back to baseline");
  process.exit(failures.length === 0 && clean ? 0 : 1);
}
