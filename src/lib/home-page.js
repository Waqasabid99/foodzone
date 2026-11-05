import { DASHBOARD_NAV, firstNavHref, hasPermission } from "@/lib/dashboard-nav";

/**
 * Where somebody lands when they open the workspace.
 *
 * A kitchen display is not a widget on a dashboard — in every product that
 * does this properly it is a dedicated screen, left on a wall all shift,
 * usually pinned to one station. So rather than copying the board onto the
 * overview, whoever's job *is* the board gets sent to it, and there stays one
 * board at one URL that keeps its `?station=` in the address bar. A copy on
 * the overview could never do that, and a fryer screen that cannot be pinned
 * to the fryer is not a fryer screen.
 *
 * Two layers, because neither alone is right:
 *
 *   * a **default read off the shape of the role** — somebody who works a
 *     board and does not take orders is a cook, and the overview has nothing
 *     on it for them;
 *   * an **override they set themselves**, because a head chef may well want
 *     the overview and a manager working a busy pass may want the board, and
 *     no condition written here can know which.
 *
 * Pure and permission-driven, like the nav: the same question the layout asks,
 * answered in one place so the redirect and the sidebar cannot disagree.
 */

/** What a person may choose on their own account page. */
export const HOME_CHOICES = [
  { value: "", label: "Whatever suits my job", hint: "Decided from what you do here." },
  { value: "overview", label: "The overview", hint: "Today's numbers and what is on the pass." },
  { value: "kitchen", label: "The kitchen board", hint: "Tickets, full screen, nothing else." },
  { value: "pass", label: "The pass", hint: "What is ready, and whose table it goes to." },
];

export const HOME_PATHS = {
  overview: "/dashboard",
  kitchen: "/dashboard/kitchen",
  pass: "/dashboard/pass",
};

/**
 * Whether the kitchen board is this person's natural home.
 *
 * Reads a board and does not take orders: that is a cook or a chef. A cashier
 * and a shift supervisor also read the board, but their day is at the counter
 * and the overview is genuinely theirs — which is also exactly who the
 * kitchen summary block on the overview is for.
 */
export function worksTheBoard(permissions = []) {
  return hasPermission(permissions, "kds.read") && !hasPermission(permissions, "orders.create");
}

/**
 * Whether the pass is this person's natural home.
 *
 * A waiter: takes orders, works a room of tables, and does not take the money.
 * That last clause is what separates them from a cashier, who also takes
 * orders and also reads the board but spends the shift at a till — and from a
 * supervisor, who holds the register and wants the overview.
 *
 * Their day is carrying food from the pass to a table and the bill back the
 * other way, so the screen that lists what is ready and whose table it belongs
 * to is their home in exactly the way the board is a cook's.
 */
export function worksTheFloor(permissions = []) {
  return (
    hasPermission(permissions, "kds.read") &&
    hasPermission(permissions, "orders.create") &&
    hasPermission(permissions, "tables.read") &&
    !hasPermission(permissions, "payments.capture")
  );
}

/**
 * The path to open, given what someone may do and what they asked for.
 *
 * A stored choice is honoured only while it is still reachable: roles change,
 * and somebody moved off the kitchen should not be redirected every morning
 * to a page that will bounce them back.
 */
export function homeFor({ permissions = [], preference = null } = {}) {
  const wanted = HOME_PATHS[preference];
  if (wanted === HOME_PATHS.kitchen && hasPermission(permissions, "kds.read")) return wanted;
  if (wanted === HOME_PATHS.pass && hasPermission(permissions, "kds.read")) return wanted;
  if (wanted === HOME_PATHS.overview && hasPermission(permissions, "dashboard.view")) return wanted;

  if (worksTheBoard(permissions)) return HOME_PATHS.kitchen;
  if (worksTheFloor(permissions)) return HOME_PATHS.pass;
  if (hasPermission(permissions, "dashboard.view")) return HOME_PATHS.overview;

  // No overview and no board: the first door they actually hold.
  return firstNavHref(DASHBOARD_NAV, permissions) ?? "/account";
}
