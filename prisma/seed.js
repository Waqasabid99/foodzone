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
import { STANDARD_CHART } from "../src/server/accounting/chart.js";

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

async function main() {
  const permissions = await seedPermissions();
  console.log(
    `Permissions: ${permissions.upserted} seeded` +
      (permissions.removed ? `, ${permissions.removed} stale removed` : ""),
  );

  const allKeys = PERMISSIONS.map((p) => p.key);
  const roles = await seedRoles(allKeys);
  console.log(`System roles: ${roles.length}`);
  console.table(roles);

  const accounts = await seedAccounts();
  console.log(`Chart of accounts: ${accounts.total} accounts (${accounts.created} new)`);

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
