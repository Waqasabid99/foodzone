import { ApiError } from "@/lib/api";
import { can } from "@/lib/api/permissions";
import { CHANNEL_KINDS, parseChannel } from "@/lib/realtime";

/**
 * Who is allowed to listen to a channel.
 *
 * The security boundary of the whole realtime layer, in one file with no I/O in
 * it so it can be read in a sitting and tested without a database. A channel
 * name arrives from the client as a string; everything that decides whether
 * that string may be subscribed to is here. The names themselves live in
 * `lib/realtime.js`, which the browser can import — this cannot, and should
 * not be able to.
 *
 * ## Channels carry no data
 *
 * A frame says *something about this changed* and nothing else. The client then
 * refetches through the ordinary endpoint it already uses.
 *
 * That looks wasteful and is the most important decision in the design. It
 * keeps authorisation in exactly one place — the existing permissioned
 * endpoint — rather than in two, the second being a serialiser with its own
 * ideas about what a waiter may see. The first time those two disagreed, the
 * quiet one would win, and a stream is very quiet. The extra round trip is
 * nothing next to the poll it replaces.
 *
 * It also makes a dropped connection self-healing. A client that reconnects
 * refetches, and refetching is the entire protocol: no replay to get right, no
 * `Last-Event-ID`, no gap to detect.
 */

/**
 * The subset of the requested channels this caller may actually listen to.
 *
 * Returns the allowed and the refused rather than throwing on the first bad
 * one. A dashboard asks for everything its screens might need in one
 * connection, and a cook who lacks `orders.read` should get the kitchen channel
 * plus a note about the other — not a 403 that leaves every board on its slow
 * poll with nothing to explain why.
 *
 * Asking for nothing *is* an error: an empty stream is a held connection that
 * can never deliver, and a client would wait on it instead of falling back.
 *
 * `allowedOrderIds` is the caller's own orders, resolved by whoever knows how
 * to ask. Order ownership is a row rather than a permission, and this module
 * does no I/O on purpose.
 */
export function authorizeChannels({ principal, requested, allowedOrderIds = [] }) {
  const names = [...new Set((Array.isArray(requested) ? requested : [requested]).filter(Boolean))];
  if (!names.length) {
    throw ApiError.validation("Name at least one channel to listen to", { channels: ["Required"] });
  }

  const ownOrders = new Set(allowedOrderIds);
  const allowed = [];
  const refused = [];

  for (const name of names) {
    const parsed = parseChannel(name);
    if (!parsed) {
      refused.push({ channel: String(name), reason: "UNKNOWN" });
      continue;
    }

    const kind = CHANNEL_KINDS[parsed.kind];

    if (kind.scope === "self") {
      // Yourself, and only yourself. A channel keyed by user id would
      // otherwise be readable by anyone who could guess an id.
      if (principal && parsed.id === principal.userId) allowed.push(parsed.name);
      else refused.push({ channel: parsed.name, reason: "NOT_YOURS" });
      continue;
    }

    if (kind.scope === "own") {
      if (ownOrders.has(parsed.id)) allowed.push(parsed.name);
      else refused.push({ channel: parsed.name, reason: "NOT_YOURS" });
      continue;
    }

    if (!principal) {
      refused.push({ channel: parsed.name, reason: "UNAUTHENTICATED" });
      continue;
    }

    /*
     * The same permission, at the same branch, the endpoint behind this channel
     * would ask for. Checked per branch rather than company-wide, so a manager
     * of one outlet cannot watch another's kitchen by editing a query string.
     */
    if (can(principal, kind.permission, { branchId: parsed.id })) allowed.push(parsed.name);
    else refused.push({ channel: parsed.name, reason: "FORBIDDEN" });
  }

  return { allowed, refused };
}

/** Which of these names are orders, so the route knows what ownership to resolve. */
export function orderIdsIn(requested) {
  return [...new Set((Array.isArray(requested) ? requested : [requested]).filter(Boolean))]
    .map((name) => parseChannel(name))
    .filter((parsed) => parsed?.kind === "order")
    .map((parsed) => parsed.id);
}
