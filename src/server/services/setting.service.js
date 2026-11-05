import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { SETTINGS, defaultSettings, settingDefinition } from "@/server/settings/registry";

/**
 * Effective settings resolve in three layers, most specific first:
 *
 *   branch row  →  global row  →  registry default
 *
 * So a branch only stores what it actually overrides, and adding a new setting
 * in code immediately has a correct value everywhere without a migration.
 *
 * Reads are cached in memory for a few seconds because pricing settings are
 * touched on every cart calculation. Writes clear the cache for the affected
 * scope; behind several instances the others converge within the TTL, which is
 * acceptable for a delivery fee and not used for anything security-sensitive.
 */
const CACHE_TTL_MS = 15_000;
const cache = new Map();

function cacheKey(branchId) {
  return branchId ?? "__global__";
}

/**
 * Clears the whole cache on any write.
 *
 * Deleting only the affected scope is tempting, but each scope is cached under
 * two keys (public and full) and a global change alters every branch's
 * effective values anyway. Settings are written rarely and read constantly, so
 * the cheap correct thing beats the clever partial one.
 */
export function invalidateSettings() {
  cache.clear();
}

/** All effective values for a scope. */
export async function getSettings({ branchId = null, publicOnly = false } = {}) {
  const key = `${cacheKey(branchId)}:${publicOnly ? "public" : "all"}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const rows = await prisma.setting.findMany({
    where: { OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
  });

  const values = defaultSettings({ publicOnly });

  // Global first, then branch, so the branch row wins.
  for (const row of [...rows.filter((r) => !r.branchId), ...rows.filter((r) => r.branchId)]) {
    const definition = settingDefinition(row.key);
    // A row whose key was removed from the registry is ignored rather than
    // surfaced — the code is the source of truth for what exists.
    if (!definition) continue;
    if (publicOnly && !definition.isPublic) continue;
    values[row.key] = row.value;
  }

  cache.set(key, { value: values, expiresAt: Date.now() + CACHE_TTL_MS });
  return values;
}

/** One effective value, with the same layering. */
export async function getSetting(key, { branchId = null } = {}) {
  const definition = settingDefinition(key);
  if (!definition) throw ApiError.validation(`Unknown setting "${key}"`);

  const values = await getSettings({ branchId });
  return values[key];
}

/** The registry plus current values — what the settings screen renders from. */
export async function describeSettings({ branchId = null } = {}) {
  const [effective, rows] = await Promise.all([
    getSettings({ branchId }),
    prisma.setting.findMany({ where: { OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] } }),
  ]);

  const globalRows = new Map(rows.filter((r) => !r.branchId).map((r) => [r.key, r]));
  const branchRows = new Map(rows.filter((r) => r.branchId).map((r) => [r.key, r]));

  return {
    branchId,
    settings: SETTINGS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      type: definition.type,
      isPublic: Boolean(definition.isPublic),
      branchOverridable: Boolean(definition.branchOverridable),
      // The choices a list setting offers, where the registry names them.
      options: definition.options ?? null,
      default: definition.default,
      globalValue: globalRows.has(definition.key) ? globalRows.get(definition.key).value : null,
      branchValue: branchRows.has(definition.key) ? branchRows.get(definition.key).value : null,
      // Which layer is actually in effect, so the UI can show "inherited".
      source: branchRows.has(definition.key) ? "BRANCH" : globalRows.has(definition.key) ? "GLOBAL" : "DEFAULT",
      value: effective[definition.key],
    })),
  };
}

/**
 * Writes a batch of settings, validating each against its registry schema.
 *
 * All-or-nothing: a partial save would leave pricing half-updated, which is
 * worse than rejecting the whole batch.
 */
export async function updateSettings({ values, branchId = null, actorId }) {
  const entries = Object.entries(values);
  if (!entries.length) throw ApiError.validation("Nothing to update");

  const errors = {};
  const prepared = [];

  for (const [key, raw] of entries) {
    const definition = settingDefinition(key);
    if (!definition) {
      errors[key] = ["Unknown setting"];
      continue;
    }
    if (branchId && !definition.branchOverridable) {
      errors[key] = ["This setting cannot be overridden per branch"];
      continue;
    }

    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) {
      errors[key] = parsed.error.issues.map((issue) => issue.message);
      continue;
    }

    prepared.push({ key, value: parsed.data, definition });
  }

  if (Object.keys(errors).length) throw ApiError.validation("Some settings are invalid", errors);

  if (branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw ApiError.notFound("Branch not found");
  }

  await prisma.$transaction(async (tx) => {
    for (const { key, value, definition } of prepared) {
      // Not an upsert: Prisma refuses null inside a compound unique `where`,
      // and the global scope is exactly branchId = null.
      const existing = await tx.setting.findFirst({ where: { key, branchId }, select: { id: true } });

      if (existing) {
        await tx.setting.update({
          where: { id: existing.id },
          data: { value, updatedById: actorId, isPublic: Boolean(definition.isPublic) },
        });
      } else {
        await tx.setting.create({
          data: {
            key,
            branchId,
            scope: branchId ? "BRANCH" : "GLOBAL",
            value,
            valueType: definition.type,
            label: definition.label,
            isPublic: Boolean(definition.isPublic),
            updatedById: actorId,
          },
        });
      }
    }
  });

  invalidateSettings();
  return describeSettings({ branchId });
}

/** Removes an override so the value falls back to the layer beneath it. */
export async function resetSetting({ key, branchId = null }) {
  if (!settingDefinition(key)) throw ApiError.validation(`Unknown setting "${key}"`);

  const existing = await prisma.setting.findFirst({ where: { key, branchId }, select: { id: true } });
  if (!existing) throw ApiError.notFound("That setting is not overridden at this level");

  await prisma.setting.delete({ where: { id: existing.id } });
  invalidateSettings();

  return describeSettings({ branchId });
}
