import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { canAny } from "@/lib/api/permissions";
import { getSetting } from "@/server/services/setting.service";
import {
  CATEGORY_KEYS,
  NOTIFICATION_CATEGORIES,
  categoryForType,
  notificationCategory,
} from "@/server/notifications/categories";

/**
 * Resolving what somebody actually wants.
 *
 * Preferences layer the way settings do — a stored row, then the category's
 * default — so signing up writes nothing and an unset preference still has a
 * correct answer. A category added next year is immediately right for everyone
 * without a backfill.
 *
 * Two defaults, not one, and the difference is the whole policy:
 *
 *   * **transactional** — on. Being told about your own order is the point of
 *     having an account, and an opt-out by omission would be a silent one.
 *   * **marketing** — whatever `notifications.marketing_optin_default` says,
 *     which ships as `false`. Opt-in is the only defensible default for
 *     advertising, and that setting has existed since notifications were built
 *     with nothing reading it.
 *
 * `inApp` is only honoured where the category permits it. For anything
 * transactional the row is the record and gets written regardless; what the
 * person switched off was the interruption. Enforcing it in the resolver
 * rather than at each call site means a new producer cannot get it wrong.
 */

/** What somebody gets when they have never touched the screen. */
async function defaultsFor() {
  const marketing = await getSetting("notifications.marketing_optin_default");

  const defaults = new Map();
  for (const category of NOTIFICATION_CATEGORIES) {
    const on = category.transactional ? true : Boolean(marketing);
    defaults.set(category.key, { inApp: on, push: on });
  }

  return defaults;
}

/**
 * One person's effective answer for every category.
 *
 * Returns a map so a bulk send can resolve each recipient without a query per
 * category per user.
 */
export async function preferencesFor(userId) {
  const [defaults, rows] = await Promise.all([
    defaultsFor(),
    prisma.notificationPreference.findMany({
      where: { userId },
      select: { category: true, inApp: true, push: true },
    }),
  ]);

  const effective = new Map(defaults);

  for (const row of rows) {
    const category = notificationCategory(row.category);
    // A row for a category that no longer exists is ignored rather than
    // deleted: a renamed category should not silently take somebody's choice
    // with it, and the row is harmless until a migration tidies it.
    if (!category) continue;

    effective.set(row.category, {
      // A transactional record is written whatever the row says. The column is
      // still stored, so a category that later becomes optional honours a
      // choice somebody already made rather than resetting it.
      inApp: category.transactional ? true : row.inApp,
      push: row.push,
    });
  }

  return effective;
}

/** The same, for several people at once — one query rather than one each. */
export async function preferencesForMany(userIds) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return new Map();

  const [defaults, rows] = await Promise.all([
    defaultsFor(),
    prisma.notificationPreference.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, category: true, inApp: true, push: true },
    }),
  ]);

  const byUser = new Map(unique.map((userId) => [userId, new Map(defaults)]));

  for (const row of rows) {
    const category = notificationCategory(row.category);
    if (!category) continue;

    byUser.get(row.userId)?.set(row.category, {
      inApp: category.transactional ? true : row.inApp,
      push: row.push,
    });
  }

  return byUser;
}

/**
 * Whether to write the row and whether to wake the devices, for one type.
 *
 * A type no category claims is **sent**. That is deliberate: an unclassified
 * notification is a gap in the registry, and the right behaviour for a gap is
 * to deliver the message so somebody notices it on a screen — not to swallow
 * it because an entry was forgotten. Silence is the one failure mode nobody
 * reports.
 */
export function decide({ type, preferences }) {
  const category = categoryForType(type);
  if (!category) return { inApp: true, push: true, category: null };

  const choice = preferences?.get(category.key) ?? { inApp: true, push: true };
  return { inApp: choice.inApp, push: choice.push, category: category.key };
}

/** Convenience for a single send: resolve and decide in one call. */
export async function decideFor({ userId, type }) {
  return decide({ type, preferences: await preferencesFor(userId) });
}

/**
 * Whether this person could ever receive a category at all.
 *
 * A category with no `requiresAny` is for anyone with an account. One that
 * names grants is only shown to somebody holding one of them, because a
 * customer offered a switch for "low stock" learns that this screen is not
 * really about them and stops reading the rest of it.
 *
 * Filtered on the server rather than in the page: the rule is "who do the
 * producers actually notify", the producers are server-side, and a client
 * reimplementing it would drift the first time a grant changed.
 */
function reachable(category, principal) {
  if (!category.requiresAny?.length) return true;
  return canAny(principal, category.requiresAny);
}

/**
 * The screen's payload: every category this person could receive, what it
 * permits, and their answer.
 *
 * `canMuteInApp` is sent rather than left for the client to infer from
 * `transactional`, so a UI cannot draw a switch that does nothing — the server
 * decides what is adjustable, and the screen renders what it is told.
 */
export async function listPreferences(principal) {
  const effective = await preferencesFor(principal.userId);

  return NOTIFICATION_CATEGORIES.filter((category) => reachable(category, principal)).map((category) => ({
    key: category.key,
    label: category.label,
    description: category.description,
    audience: category.audience,
    canMuteInApp: !category.transactional,
    inApp: effective.get(category.key)?.inApp ?? true,
    push: effective.get(category.key)?.push ?? true,
  }));
}

/**
 * Saves what somebody chose.
 *
 * Only the categories named are touched, so a screen that shows a subset — a
 * customer never sees the staff category — cannot wipe the rest by submitting
 * what it happens to know about.
 *
 * An attempt to mute a transactional record is refused rather than accepted
 * and quietly ignored. Accepting it would leave the screen showing a switch
 * turned off while the notifications kept arriving, and the person would
 * reasonably conclude the feature is broken.
 */
export async function savePreferences({ principal, categories }) {
  const userId = principal.userId;

  const entries = Object.entries(categories ?? {});
  if (!entries.length) throw ApiError.validation("Nothing to save", { categories: ["Name at least one category"] });

  const unknown = entries.map(([key]) => key).filter((key) => !CATEGORY_KEYS.includes(key));
  if (unknown.length) {
    throw ApiError.validation("Unknown notification category", { categories: unknown });
  }

  /*
   * Refused rather than stored. Saving a preference for a category somebody
   * cannot receive would leave a row that does nothing and reads, to anyone
   * auditing it later, as though they had opted out of something.
   */
  const unreachable = entries
    .map(([key]) => notificationCategory(key))
    .filter((category) => !reachable(category, principal))
    .map((category) => category.key);

  if (unreachable.length) {
    throw ApiError.validation("That is not something you can be sent", { categories: unreachable });
  }

  for (const [key, choice] of entries) {
    const category = notificationCategory(key);
    if (category.transactional && choice.inApp === false) {
      throw ApiError.validation(`"${category.label}" cannot be switched off completely`, {
        [key]: ["This is a record of something that happened. You can turn the alerts off instead."],
      });
    }
  }

  for (const [key, choice] of entries) {
    const category = notificationCategory(key);
    const inApp = category.transactional ? true : choice.inApp !== false;
    const push = choice.push !== false;

    await prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category: key } },
      create: { userId, category: key, inApp, push },
      update: { inApp, push },
    });
  }

  return listPreferences(principal);
}
