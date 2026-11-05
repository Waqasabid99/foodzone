// Seeds the RBAC baseline: the permission catalogue and the system roles.
//
// Deliberately contains NO demo or sample data — no users, branches, products
// or orders. It is safe (and expected) to run on any environment, including
// production, and is idempotent: run it again after adding a permission or
// changing a role's grants and it converges.
//
//   node prisma/seed.js
//
// What it will change on a re-run:
//   * inserts new permissions, updates the label/description/order of existing
//     ones
//   * deletes seeded permissions that are no longer in the catalogue, which
//     cascades to any role that still granted them
//   * updates system roles and rewrites their permission sets to match exactly
//
// What it never touches: roles an admin created (isSystem = false), and every
// user's role assignments.

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { PERMISSIONS } from "./seeds/permissions.js";
import { SYSTEM_ROLES, resolvePermissionKeys } from "./seeds/roles.js";
import { CONTENT_PAGES } from "./seeds/content-pages.js";
import { STANDARD_CHART } from "../src/server/accounting/chart.js";
import { fiscalYearFor, fiscalYearStartMonth, monthsBetween } from "../src/server/accounting/fiscal-calendar.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function seedPermissions() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      // isSystem is intentionally re-asserted: a permission in the catalogue is
      // always a system permission.
      update: {
        module: permission.module,
        action: permission.action,
        label: permission.label,
        description: permission.description,
        sortOrder: permission.sortOrder,
        isSystem: true,
      },
    });
  }

  const removed = await prisma.permission.deleteMany({
    where: { isSystem: true, key: { notIn: PERMISSIONS.map((p) => p.key) } },
  });

  return { upserted: PERMISSIONS.length, removed: removed.count };
}

async function seedRoles(allKeys) {
  const summary = [];

  for (const role of SYSTEM_ROLES) {
    const keys = resolvePermissionKeys(role, allKeys);

    const record = await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        scope: role.scope,
        level: role.level,
        isSystem: true,
      },
      update: {
        name: role.name,
        description: role.description,
        scope: role.scope,
        level: role.level,
        isSystem: true,
      },
    });

    const permissionIds = await prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });

    // Rewrite the grant set so removing a permission from a role in code
    // actually revokes it.
    await prisma.rolePermission.deleteMany({
      where: { roleId: record.id, permissionId: { notIn: permissionIds.map((p) => p.id) } },
    });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((p) => ({ roleId: record.id, permissionId: p.id })),
      skipDuplicates: true,
    });

    summary.push({ role: role.key, scope: role.scope, level: role.level, permissions: keys.length });
  }

  return summary;
}

/**
 * Seeds the chart of accounts.
 *
 * The posting rules resolve accounts by code, so these have to exist before any
 * business event can reach the ledger. Marked `isSystem` and never deleted on a
 * re-run: an account that has been posted to is part of the audit trail, and
 * removing it because it left the code would orphan every line that referenced
 * it.
 *
 * Names and descriptions are refreshed; `isActive` is not, so an operator who
 * deactivated an account they do not use keeps that choice.
 */
async function seedAccounts() {
  const byCode = new Map();
  let created = 0;

  for (const account of STANDARD_CHART) {
    const parentId = account.parentCode ? byCode.get(account.parentCode) : null;

    const existing = await prisma.account.findUnique({ where: { code: account.code }, select: { id: true } });

    const record = await prisma.account.upsert({
      where: { code: account.code },
      create: {
        code: account.code,
        name: account.name,
        type: account.type,
        subType: account.subType ?? null,
        normalBalance: account.normalBalance,
        parentId,
        description: account.description ?? null,
        isSystem: true,
      },
      update: {
        name: account.name,
        type: account.type,
        subType: account.subType ?? null,
        normalBalance: account.normalBalance,
        parentId,
        description: account.description ?? null,
        isSystem: true,
      },
      select: { id: true },
    });

    if (!existing) created += 1;
    byCode.set(account.code, record.id);
  }

  return { total: STANDARD_CHART.length, created };
}

/**
 * Opens the fiscal year covering today, if nothing covers it yet.
 *
 * Without this a fresh install cannot keep books at all. `assertPostable`
 * refuses any date that falls in no accounting period, so on day one every
 * sale, every bill and every payroll run is rejected, and the forty seeded
 * accounts sit there unusable. The chart of accounts without a calendar is
 * half an installation.
 *
 * Defaults to Pakistan's financial year, 1 July to 30 June; a client whose
 * year differs sets FISCAL_YEAR_START_MONTH before the first run.
 *
 * Idempotent, and deliberately timid about it:
 *
 *   * a period already covering today means the calendar is set up — leave it
 *     completely alone, whatever its shape. An installation that chose April,
 *     or entered its years by hand, is not corrected by a seed.
 *   * a fiscal year that overlaps the computed span but has no period for
 *     today is reported and not touched. Overlapping years would make "which
 *     period does this date belong to" ambiguous and every posting after that
 *     point a coin toss, and a year with a hole in it is somebody's mistake to
 *     look at, not a seed's to paper over.
 */
async function seedFiscalYear(startMonth, today = new Date()) {
  const year = fiscalYearFor(today, { startMonth });

  // Stored as `@db.Date`, so the comparison is date-only.
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const covering = await prisma.accountingPeriod.findFirst({
    where: { startDate: { lte: day }, endDate: { gte: day } },
    select: { name: true },
  });
  if (covering) return { action: "present", name: covering.name };

  const overlapping = await prisma.fiscalYear.findFirst({
    where: { startDate: { lte: year.endDate }, endDate: { gte: year.startDate } },
    select: { name: true },
  });
  if (overlapping) return { action: "conflict", name: overlapping.name, wanted: year.name };

  const months = monthsBetween(year.startDate, year.endDate);

  await prisma.fiscalYear.create({
    data: {
      name: year.name,
      startDate: year.startDate,
      endDate: year.endDate,
      periods: { create: months.map((month) => ({ ...month, status: "OPEN" })) },
    },
  });

  return { action: "created", name: year.name, periods: months.length, startMonth };
}

/**
 * Seeds the public pages, without ever overwriting edited prose.
 *
 * A page whose body still matches the seed exactly is refreshed, so improving
 * the drafts reaches installations that never touched them. A page somebody
 * has edited is left completely alone — re-running a seed must never be the
 * thing that deletes an owner's words.
 */
async function seedContentPages() {
  let created = 0;
  let refreshed = 0;
  let kept = 0;

  for (const page of CONTENT_PAGES) {
    const existing = await prisma.contentPage.findUnique({
      where: { slug: page.slug },
      select: { id: true, body: true, title: true, summary: true },
    });

    if (!existing) {
      await prisma.contentPage.create({ data: page });
      created += 1;
      continue;
    }

    const untouched =
      existing.body === page.body && existing.title === page.title && existing.summary === page.summary;
    if (!untouched) {
      kept += 1;
      continue;
    }

    await prisma.contentPage.update({ where: { slug: page.slug }, data: page });
    refreshed += 1;
  }

  return { created, refreshed, kept };
}

async function main() {
  // Read first and write nothing until it parses: a typo'd
  // FISCAL_YEAR_START_MONTH should stop the seed, not stop it halfway.
  const startMonth = fiscalYearStartMonth();

  const permissions = await seedPermissions();
  console.log(
    `Permissions: ${permissions.upserted} seeded` +
      (permissions.removed ? `, ${permissions.removed} stale removed` : ""),
  );

  const allKeys = PERMISSIONS.map((p) => p.key);
  const roles = await seedRoles(allKeys);
  console.log(`System roles: ${roles.length}`);
  console.table(roles);

  const pages = await seedContentPages();
  console.log(
    `Public pages: ${pages.created} created, ${pages.refreshed} refreshed` +
      (pages.kept ? `, ${pages.kept} left as edited` : ""),
  );

  const accounts = await seedAccounts();
  console.log(`Chart of accounts: ${accounts.total} accounts (${accounts.created} new)`);

  const fiscal = await seedFiscalYear(startMonth);
  if (fiscal.action === "created") {
    const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2000, fiscal.startMonth - 1, 1)),
    );
    console.log(`Fiscal year: opened ${fiscal.name} with ${fiscal.periods} monthly periods (year starts in ${month})`);
  } else if (fiscal.action === "present") {
    console.log(`Fiscal year: ${fiscal.name} already covers today, left untouched`);
  } else {
    // Two shapes of the same problem: the year exists with a hole where today
    // should be, or a differently-shaped year is in the way. Either is somebody
    // else's decision, so the seed reports and stops.
    const clash =
      fiscal.name === fiscal.wanted
        ? `${fiscal.name} exists but has no period covering today`
        : `${fiscal.wanted} would overlap ${fiscal.name}, which has no period covering today`;
    console.warn(`Fiscal year: not created — ${clash}. Fix it by hand; nothing can post to the ledger until a period covers today.`);
  }

  const customRoles = await prisma.role.count({ where: { isSystem: false } });
  if (customRoles > 0) console.log(`Left ${customRoles} admin-created role(s) untouched.`);

  const customAccounts = await prisma.account.count({ where: { isSystem: false } });
  if (customAccounts > 0) console.log(`Left ${customAccounts} admin-created account(s) untouched.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
