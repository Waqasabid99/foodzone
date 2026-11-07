/**
 * Fills an installation with a working restaurant, so it can be shown to
 * somebody.
 *
 *   npm run db:demo
 *
 * Completely separate from `prisma/seed.js`, which deliberately creates no
 * data at all and is safe to run in production. This is the opposite: it is
 * invented content, and it must never reach a real restaurant's database.
 * It refuses outright when NODE_ENV is production.
 *
 * Idempotent. Everything is keyed by slug or code and upserted, so running it
 * again after editing `prisma/demo/menu.js` updates the catalog in place
 * rather than growing a second copy of it.
 *
 * What a prospect should see after this runs: a storefront with photographs
 * and prices, a menu that is laid out, branches with tables and QR codes, and
 * — once the order history stage runs — a dashboard with numbers on it.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { CATEGORIES, PRODUCTS, MODIFIER_GROUPS, MENU_SECTIONS, PRODUCT_IMAGE } from "../prisma/demo/menu.js";
import { random, pick, CUSTOMERS, GUESTS, BASKETS, CHANNELS, HOUR_WEIGHTS, DAY_MULTIPLIER } from "../prisma/demo/history.js";
import { hashPassword } from "../src/server/utils/password.js";
import { postOrderSale, postPaymentReceipt } from "../src/server/services/posting.service.js";
import { bootstrapInstallation, installationNeedsSetup } from "../src/server/services/bootstrap.service.js";
import { registerDevice } from "../src/server/services/attendance-device.service.js";
import { DEPARTMENTS, EMPLOYEES, DEVICES } from "../prisma/demo/staff.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run: this writes invented data and NODE_ENV is production.");
  process.exit(1);
}

const BRANCHES = [
  { code: "FZ-KHI-01", name: "FoodZone Clifton", city: "Karachi", addressLine1: "Block 4, Clifton", phone: "+92 21 3530 1001" },
  { code: "FZ-KHI-02", name: "FoodZone Gulshan", city: "Karachi", addressLine1: "Gulshan-e-Iqbal Block 13", phone: "+92 21 3482 2002" },
];

const log = (...parts) => console.log(" ", ...parts);

async function seedBranches() {
  const branches = [];
  for (const branch of BRANCHES) {
    branches.push(
      await prisma.branch.upsert({
        where: { code: branch.code },
        create: { ...branch, country: "Pakistan", timezone: "Asia/Karachi", currency: "PKR", isActive: true },
        update: { name: branch.name, city: branch.city, phone: branch.phone, isActive: true },
      }),
    );
  }
  log(`branches: ${branches.length}`);
  return branches;
}

async function seedCategories() {
  const bySlug = new Map();
  for (const [index, category] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      create: { ...category, sortOrder: index, isActive: true },
      update: { name: category.name, description: category.description, imageUrl: category.imageUrl, sortOrder: index },
    });
    bySlug.set(category.slug, row);
  }
  log(`categories: ${bySlug.size}`);
  return bySlug;
}

async function seedModifierGroups() {
  const byKey = new Map();
  for (const group of MODIFIER_GROUPS) {
    const row = await prisma.modifierGroup.upsert({
      // `internalName` is the unique one, so it is what makes this repeatable.
      where: { internalName: `demo:${group.key}` },
      create: {
        name: group.name,
        internalName: `demo:${group.key}`,
        selectionType: group.selectionType,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        isActive: true,
      },
      update: { name: group.name, selectionType: group.selectionType, minSelect: group.minSelect, maxSelect: group.maxSelect },
    });

    // Options are replaced wholesale: they have no natural key, and a demo
    // catalog edited and re-run should not accumulate three "Extra cheese".
    await prisma.modifierOption.deleteMany({ where: { groupId: row.id } });
    await prisma.modifierOption.createMany({
      data: group.options.map((option, index) => ({
        groupId: row.id,
        name: option.name,
        priceDelta: option.priceDelta,
        isDefault: option.isDefault ?? false,
        sortOrder: index,
      })),
    });

    byKey.set(group.key, row);
  }
  log(`modifier groups: ${byKey.size}`);
  return byKey;
}

async function seedProducts(categories, modifierGroups) {
  const bySlug = new Map();

  for (const [index, product] of PRODUCTS.entries()) {
    const category = categories.get(product.category);
    const imageUrl = PRODUCT_IMAGE(product.image);

    const row = await prisma.product.upsert({
      where: { slug: product.slug },
      create: {
        slug: product.slug,
        name: product.name,
        description: product.description,
        shortDescription: product.shortDescription,
        type: product.variants.length > 1 ? "VARIANT" : "SIMPLE",
        categoryId: category.id,
        imageUrl,
        spiceLevel: product.spiceLevel,
        calories: product.calories,
        prepTimeMinutes: product.prepTimeMinutes,
        isActive: true,
        sortOrder: index,
      },
      update: {
        name: product.name,
        description: product.description,
        shortDescription: product.shortDescription,
        categoryId: category.id,
        imageUrl,
        spiceLevel: product.spiceLevel,
        calories: product.calories,
        prepTimeMinutes: product.prepTimeMinutes,
        sortOrder: index,
      },
    });

    // The gallery, separate from the card image the storefront uses.
    await prisma.productImage.deleteMany({ where: { productId: row.id } });
    await prisma.productImage.create({ data: { productId: row.id, url: imageUrl, altText: product.name, sortOrder: 0 } });

    for (const [vIndex, variant] of product.variants.entries()) {
      const sku = `${product.slug}-${variant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 60);
      await prisma.productVariant.upsert({
        where: { sku },
        create: {
          productId: row.id,
          name: variant.name,
          sku,
          price: variant.price,
          standardCost: variant.cost,
          isDefault: variant.isDefault ?? false,
          isActive: true,
          sortOrder: vIndex,
        },
        update: { name: variant.name, price: variant.price, standardCost: variant.cost, isDefault: variant.isDefault ?? false, sortOrder: vIndex },
      });
    }

    await prisma.productModifierGroup.deleteMany({ where: { productId: row.id } });
    for (const [mIndex, key] of (product.modifiers ?? []).entries()) {
      const group = modifierGroups.get(key);
      if (group) {
        await prisma.productModifierGroup.create({ data: { productId: row.id, groupId: group.id, sortOrder: mIndex } });
      }
    }

    bySlug.set(product.slug, row);
  }

  const variants = await prisma.productVariant.count({ where: { product: { slug: { in: PRODUCTS.map((p) => p.slug) } } } });
  log(`products: ${bySlug.size} with ${variants} variants, each with a photograph`);
  return bySlug;
}

async function seedMenus(branches, products) {
  for (const branch of branches) {
    const menu = await prisma.menu.upsert({
      where: { id: (await prisma.menu.findFirst({ where: { branchId: branch.id, slug: "all-day" }, select: { id: true } }))?.id ?? "none" },
      create: { branchId: branch.id, name: "All day", slug: "all-day", type: "DINE_IN", isActive: true, isDefault: true },
      update: { name: "All day", isActive: true, isDefault: true },
    });

    // Sections and their items are rebuilt rather than reconciled: the layout
    // is defined in one list in `menu.js`, and reordering it there should be
    // what the screen shows.
    await prisma.menuItem.deleteMany({ where: { menuId: menu.id } });
    await prisma.menuSection.deleteMany({ where: { menuId: menu.id } });

    for (const [sIndex, section] of MENU_SECTIONS.entries()) {
      const row = await prisma.menuSection.create({
        data: { menuId: menu.id, name: section.name, sortOrder: sIndex },
      });

      for (const [pIndex, slug] of section.slugs.entries()) {
        const product = products.get(slug);
        if (!product) continue;
        await prisma.menuItem.create({
          data: {
            menuId: menu.id,
            sectionId: row.id,
            productId: product.id,
            isAvailable: true,
            isRecommended: Boolean(section.recommended),
            sortOrder: pIndex,
          },
        });
      }
    }
  }
  log(`menus: one "All day" menu per branch, ${MENU_SECTIONS.length} sections each`);
}

async function seedTablesAndQr(branches) {
  let tables = 0;
  let codes = 0;

  for (const branch of branches) {
    const menu = await prisma.menu.findFirst({ where: { branchId: branch.id, slug: "all-day" }, select: { id: true } });
    const areas = [
      { area: "Ground floor", count: 8, seats: 4 },
      { area: "Family hall", count: 4, seats: 6 },
    ];

    for (const { area, count, seats } of areas) {
      for (let n = 1; n <= count; n += 1) {
        const name = `${area === "Family hall" ? "F" : "T"}-${String(n).padStart(2, "0")}`;
        const existing = await prisma.restaurantTable.findFirst({ where: { branchId: branch.id, name }, select: { id: true } });
        const table = existing
          ? await prisma.restaurantTable.update({ where: { id: existing.id }, data: { area, seats, isActive: true } })
          : await prisma.restaurantTable.create({ data: { branchId: branch.id, name, area, seats, isActive: true } });
        tables += 1;

        // One code per table, so the QR analytics screens have something to
        // rank. The code is derived, not random, so re-running does not
        // invalidate a sticker somebody printed for a demo.
        const code = `${branch.code}-${name}`.toUpperCase();
        await prisma.qrCode.upsert({
          where: { code },
          create: { code, branchId: branch.id, targetType: "TABLE", tableId: table.id, menuId: menu?.id ?? null, isActive: true },
          update: { tableId: table.id, menuId: menu?.id ?? null, isActive: true },
        });
        codes += 1;
      }
    }
  }
  log(`tables: ${tables}, each with its own QR code (${codes})`);
}

/** Orders this many days back, which is enough for a month-on-month chart. */
const HISTORY_DAYS = 30;

/** Karachi is UTC+5 all year, so a wall-clock hour is a fixed offset. */
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

function atKarachi(day, hour, minute) {
  const utc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute) - KARACHI_OFFSET_MS;
  return new Date(utc);
}

async function seedCustomers() {
  const customerRole = await prisma.role.findUnique({ where: { key: "customer" }, select: { id: true } });
  // One password for every demo customer, because somebody showing the system
  // will want to sign in as one and should not have eight to remember.
  const passwordHash = await hashPassword("demo-customer-pass");
  const users = [];

  for (const person of CUSTOMERS) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: {
        name: person.name,
        email: person.email,
        phone: person.phone,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      update: { name: person.name, phone: person.phone },
      select: { id: true, name: true, phone: true },
    });

    if (customerRole) {
      const held = await prisma.userRoleAssignment.findFirst({ where: { userId: user.id, roleId: customerRole.id }, select: { id: true } });
      if (!held) await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: customerRole.id } });
    }

    users.push(user);
  }

  log(`customers: ${users.length} (all sign in with demo-customer-pass)`);
  return users;
}

/**
 * Builds one order with its lines, priced the way the real thing prices.
 *
 * Tax is applied per line at the standard Pakistani restaurant rate rather
 * than left at zero: a demo whose tax column is all dashes invites the
 * question of whether the system does tax at all.
 */
function buildOrder({ rng, branch, variantsBySlug, placedAt, number }) {
  const basket = pick(rng, BASKETS);
  const route = pick(rng, CHANNELS);
  const TAX_RATE = 0.16;

  const lines = [];
  let subtotal = 0;
  let taxTotal = 0;
  let costTotal = 0;

  for (const [slug, quantity] of basket.items) {
    const variant = variantsBySlug.get(slug);
    if (!variant) continue;

    const unitPrice = Number(variant.price);
    const unitCost = Number(variant.standardCost ?? 0);
    const lineNet = unitPrice * quantity;
    const lineTax = Math.round(lineNet * TAX_RATE * 100) / 100;

    subtotal += lineNet;
    taxTotal += lineTax;
    costTotal += unitCost * quantity;

    lines.push({
      productId: variant.productId,
      variantId: variant.id,
      nameSnapshot: variant.productName,
      skuSnapshot: variant.sku,
      quantity,
      unitPrice,
      taxRate: TAX_RATE,
      taxAmount: lineTax,
      lineTotal: lineNet + lineTax,
      unitCost,
      status: "SERVED",
    });
  }

  const deliveryFee = route.type === "DELIVERY" ? 150 : 0;
  const grandTotal = Math.round((subtotal + taxTotal + deliveryFee) * 100) / 100;

  return { basket, route, lines, subtotal, taxTotal, deliveryFee, costTotal, grandTotal, placedAt, number };
}

/**
 * A month of orders, plus a handful still in flight today.
 *
 * Written straight through Prisma rather than through the ordering service,
 * because every one of these needs a date in the past and the service — quite
 * rightly — stamps everything with now. The ledger is then posted through the
 * real posting rules, so the financial statements are genuine double-entry
 * rather than numbers typed into a table.
 */
async function seedOrders(branches, customers) {
  /*
   * The catalog upserts; a month of trading cannot.
   *
   * Orders carry a unique number and a posted ledger entry behind them, so
   * regenerating them would either collide or quietly double a restaurant's
   * revenue on the screen somebody is being shown. Deleting them is worse:
   * the journal references orders by id without a foreign key, so it would
   * leave entries pointing at nothing and a trial balance that no longer ties
   * to any order.
   *
   * So the history is written once. To rebuild it, drop the database and seed
   * again — which for a demo takes under a minute and is the honest reset.
   */
  const existing = await prisma.order.count();
  if (existing > 0) {
    log(`orders: ${existing} already here, left alone (drop the database to rebuild the history)`);
    return [];
  }

  const rng = random();

  const variants = await prisma.productVariant.findMany({
    where: { isDefault: true, product: { slug: { in: PRODUCTS.map((p) => p.slug) } } },
    select: { id: true, sku: true, price: true, standardCost: true, productId: true, product: { select: { slug: true, name: true } } },
  });
  const variantsBySlug = new Map(variants.map((v) => [v.product.slug, { ...v, productName: v.product.name }]));

  const tablesByBranch = new Map();
  for (const branch of branches) {
    tablesByBranch.set(branch.id, await prisma.restaurantTable.findMany({ where: { branchId: branch.id }, select: { id: true } }));
  }

  const today = new Date();
  let sequence = 1;
  const created = [];

  for (let back = HISTORY_DAYS; back >= 0; back -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    const multiplier = DAY_MULTIPLIER[day.getUTCDay()];

    for (const branch of branches) {
      // The second branch is the quieter one, which is how two outlets of the
      // same chain actually compare and makes the branch filter worth using.
      const branchFactor = branch.code.endsWith("01") ? 1 : 0.6;

      for (const [hour, weight] of HOUR_WEIGHTS.entries()) {
        if (weight === 0) continue;
        const expected = (weight / 8) * multiplier * branchFactor;
        const count = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);

        for (let n = 0; n < count; n += 1) {
          const placedAt = atKarachi(day, hour, Math.floor(rng() * 60));
          // Today's late orders are the ones left mid-flight below; anything
          // older is finished business.
          const order = buildOrder({
            rng,
            branch,
            variantsBySlug,
            placedAt,
            number: `${branch.code.slice(-2)}-${day.toISOString().slice(2, 10).replace(/-/g, "")}-${String(sequence++).padStart(4, "0")}`,
          });
          created.push({ branch, order });
        }
      }
    }
  }

  log(`generating ${created.length} orders across ${HISTORY_DAYS + 1} days…`);

  const liveStatuses = ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
  let live = 0;
  const posted = [];

  for (const { branch, order } of created) {
    const minutesAgo = (Date.now() - order.placedAt.getTime()) / 60000;
    // Anything from the last three hours is still happening. Everything else
    // is history, and a small slice of history was cancelled, because a month
    // with no cancellations is not a real month.
    const isLive = minutesAgo < 180 && live < 9;
    const cancelled = !isLive && rng() < 0.04;

    let status = "COMPLETED";
    if (isLive) {
      status = liveStatuses[live % liveStatuses.length];
      live += 1;
    } else if (cancelled) {
      status = "CANCELLED";
    }

    const person = rng() < 0.6 ? customers[Math.floor(rng() * customers.length)] : null;
    const guest = person ? null : GUESTS[Math.floor(rng() * GUESTS.length)];
    const tables = tablesByBranch.get(branch.id) ?? [];
    const table = order.route.type === "DINE_IN" && tables.length ? tables[Math.floor(rng() * tables.length)] : null;

    const completedAt = status === "COMPLETED" ? new Date(order.placedAt.getTime() + 28 * 60000) : null;

    const row = await prisma.order.create({
      data: {
        orderNumber: order.number,
        branchId: branch.id,
        userId: person?.id ?? null,
        guestName: guest?.name ?? null,
        guestPhone: guest?.phone ?? null,
        guestPhoneKey: guest ? guest.phone.replace(/\D/g, "").slice(-10) : null,
        channel: order.route.channel,
        type: order.route.type,
        status,
        paymentState: status === "COMPLETED" ? "PAID" : status === "CANCELLED" ? "UNPAID" : "UNPAID",
        tableId: table?.id ?? null,
        guestCount: table ? 2 + Math.floor(rng() * 4) : null,
        currency: "PKR",
        subtotal: order.subtotal,
        taxTotal: order.taxTotal,
        deliveryFee: order.deliveryFee,
        grandTotal: order.grandTotal,
        paidTotal: status === "COMPLETED" ? order.grandTotal : 0,
        costTotal: order.costTotal,
        placedAt: order.placedAt,
        confirmedAt: status === "PENDING" ? null : new Date(order.placedAt.getTime() + 60000),
        completedAt,
        cancelledAt: status === "CANCELLED" ? new Date(order.placedAt.getTime() + 6 * 60000) : null,
        cancelReason: status === "CANCELLED" ? "Customer changed their mind" : null,
        items: { create: order.lines },
      },
      select: { id: true, grandTotal: true },
    });

    if (status === "COMPLETED") {
      const method = order.route.channel === "POS" ? "CASH" : rng() < 0.55 ? "CARD" : "CASH_ON_DELIVERY";
      const payment = await prisma.payment.create({
        data: {
          orderId: row.id,
          branchId: branch.id,
          method,
          provider: method === "CARD" ? "safepay" : "cash",
          status: "CAPTURED",
          amount: order.grandTotal,
          currency: "PKR",
          feeAmount: method === "CARD" ? Math.round(Number(order.grandTotal) * 0.025 * 100) / 100 : 0,
          capturedAt: completedAt,
          cardBrand: method === "CARD" ? "Visa" : null,
          cardLast4: method === "CARD" ? String(4000 + Math.floor(rng() * 5999)).slice(-4) : null,
        },
        select: { id: true },
      });
      posted.push({ orderId: row.id, paymentId: payment.id });
    }
  }

  log(`orders: ${created.length} (${posted.length} completed and paid, ${live} still in flight right now)`);
  return posted;
}

/**
 * Puts the month through the real posting rules.
 *
 * This is the step that makes the financial screens worth opening: revenue,
 * cost of sales, tax payable and the cash and card accounts are all produced
 * by the same code a live sale goes through, so the trial balance balances
 * because it is true and not because it was typed in.
 */
async function postLedger(posted) {
  if (!posted.length) return;

  let sales = 0;
  let receipts = 0;
  const failures = new Map();

  for (const { orderId, paymentId } of posted) {
    try {
      await postOrderSale(orderId);
      sales += 1;
    } catch (error) {
      failures.set(error.message, (failures.get(error.message) ?? 0) + 1);
    }
    try {
      await postPaymentReceipt(paymentId);
      receipts += 1;
    } catch (error) {
      failures.set(error.message, (failures.get(error.message) ?? 0) + 1);
    }
  }

  log(`ledger: ${sales} sales and ${receipts} receipts posted`);
  for (const [message, count] of failures) log(`  ${count} posting(s) refused: ${message}`);
}

/**
 * The owner, before anything else creates a user.
 *
 * Order matters here and it is not obvious: setup refuses once *any* user
 * exists, and this script creates eight customers. Seeding the demo before
 * creating the owner therefore locks you out of your own demo, which is a
 * confusing ten minutes to spend. So the owner is made first, through the
 * same service `/setup` uses.
 */
const DEMO_OWNER = { name: "Ayesha Khan", email: "owner@foodzone.demo", password: "demo-owner-pass" };

async function seedOwner() {
  if (!(await installationNeedsSetup())) {
    const owner = await prisma.user.findFirst({ where: { isSuperAdmin: true }, select: { email: true } });
    log(`owner: already set up${owner ? ` (${owner.email})` : ""}`);
    return;
  }

  await bootstrapInstallation({
    owner: DEMO_OWNER,
    branch: { code: BRANCHES[0].code, name: BRANCHES[0].name, city: BRANCHES[0].city, timezone: "Asia/Karachi", currency: "PKR" },
  });
  log(`owner: ${DEMO_OWNER.email} / ${DEMO_OWNER.password}`);
}

/**
 * Staff, and a terminal on each branch's wall.
 *
 * Devices are registered through the real service, which means the key is
 * generated and hashed exactly as it would be for hardware — and shown once,
 * here, because that is the only time it exists in readable form. Running this
 * again leaves an existing terminal alone rather than rotating its key out
 * from under a simulator that is mid-shift.
 */
async function seedStaff(branches) {
  const departments = new Map();
  for (const department of DEPARTMENTS) {
    departments.set(
      department.code,
      await prisma.department.upsert({
        where: { code: department.code },
        create: { code: department.code, name: department.name, isActive: true },
        update: { name: department.name },
      }),
    );
  }

  for (const person of EMPLOYEES) {
    await prisma.employee.upsert({
      where: { employeeCode: person.code },
      create: {
        employeeCode: person.code,
        branchId: branches[person.branch].id,
        departmentId: departments.get(person.department).id,
        designation: person.designation,
        firstName: person.first,
        lastName: person.last,
        biometricId: person.biometricId,
        employmentType: "FULL_TIME",
        status: "ACTIVE",
        salaryType: "MONTHLY",
        baseSalary: person.salary,
        currency: "PKR",
        joinedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      },
      update: { designation: person.designation, branchId: branches[person.branch].id, baseSalary: person.salary },
    });
  }

  log(`staff: ${EMPLOYEES.length} employees across ${departments.size} departments`);

  const keys = [];
  for (const device of DEVICES) {
    const existing = await prisma.attendanceDevice.findUnique({ where: { serialNumber: device.serial }, select: { id: true } });
    if (existing) {
      keys.push({ serial: device.serial, apiKey: null });
      continue;
    }
    const registered = await registerDevice({
      branchId: branches[device.branch].id,
      name: device.name,
      serialNumber: device.serial,
      vendor: device.vendor,
      model: device.model,
    });
    keys.push({ serial: device.serial, apiKey: registered.apiKey });
  }

  log(`terminals: ${DEVICES.length} registered`);
  return keys;
}

async function main() {
  console.log("\nSeeding the demo restaurant\n");

  await seedOwner();
  const branches = await seedBranches();
  const categories = await seedCategories();
  const modifierGroups = await seedModifierGroups();
  const products = await seedProducts(categories, modifierGroups);
  await seedMenus(branches, products);
  await seedTablesAndQr(branches);

  const deviceKeys = await seedStaff(branches);
  const customers = await seedCustomers();
  const posted = await seedOrders(branches, customers);
  await postLedger(posted);

  const fresh = deviceKeys.filter((d) => d.apiKey);
  if (fresh.length) {
    console.log("\nTerminal keys — shown once, and needed by scripts/attendance-terminal.mjs:");
    for (const device of fresh) console.log(`  ${device.serial}  ${device.apiKey}`);
  }

  console.log(`\nDone. Sign in at /login as ${DEMO_OWNER.email} with the password above.`);
  console.log("Customers use their own address with the password demo-customer-pass.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
