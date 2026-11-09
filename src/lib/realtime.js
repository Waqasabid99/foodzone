/**
 * What a live channel is called — shared vocabulary, no privileges.
 *
 * Both sides need to agree on the string. The server publishes to it and
 * decides who may listen; the browser names it in the URL it opens. So the
 * naming lives here, importable from a client component, and the *authorising*
 * lives in `server/realtime/channels.js`, which cannot be imported into a
 * bundle because deciding permissions needs the database.
 *
 * Splitting them is not tidiness. A client component that reached for the
 * server module would pull the whole permission resolver — and Prisma behind
 * it — into the browser bundle, and the build failure that follows is a long
 * way from the cause.
 *
 * The permission each kind requires is named here too, which is safe: the
 * dashboard already ships every permission key it checks in order to decide
 * what to render. Knowing that watching a kitchen takes `kds.read` grants
 * nobody `kds.read`.
 */

/** The channel kinds, and what it takes to listen to one. */
export const CHANNEL_KINDS = {
  /** A branch's orders: the till, the order list, the dispatch board. */
  "branch-orders": { permission: "orders.read", scope: "branch" },
  /** A branch's kitchen and pass boards. Its own kind because a cook holds `kds.read` and nothing else. */
  "branch-kds": { permission: "kds.read", scope: "branch" },
  /** One order, for whoever placed it. Ownership is a row, so the server resolves it. */
  order: { permission: null, scope: "own" },
  /** Your own notifications, and only ever your own. */
  user: { permission: null, scope: "self" },
};

/** `branch-kds:ckx…` — the kind, then the id it is about. */
export function channelName(kind, id) {
  return `${kind}:${id}`;
}

export const channel = {
  branchOrders: (branchId) => channelName("branch-orders", branchId),
  branchKds: (branchId) => channelName("branch-kds", branchId),
  order: (orderId) => channelName("order", orderId),
  user: (userId) => channelName("user", userId),
};

/**
 * Splits a name back into its parts, or null if it is not shaped like one.
 *
 * Ids are cuids, so anything outside the cuid alphabet is either a typo or
 * somebody probing the endpoint. Both get the same answer, which is why this
 * validates rather than trusting the split.
 */
export function parseChannel(name) {
  const text = String(name ?? "");
  const separator = text.indexOf(":");
  if (separator < 1) return null;

  const kind = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!CHANNEL_KINDS[kind] || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;

  return { kind, id, name: `${kind}:${id}` };
}
