import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * The live channel: one publisher, many open browsers.
 *
 * Deliberately the smallest thing that works, behind an interface narrow enough
 * to replace. `publish` and `subscribe` is the whole surface, and the driver
 * underneath is a map of channel name to the set of listeners in **this
 * process**.
 *
 * ## Why in-memory, and what that costs
 *
 * This deployment is one long-lived Node server, so every publisher and every
 * open stream are in the same process and a map is sufficient. No Redis to run,
 * no `LISTEN` connection per viewer — which matters, because a kitchen board
 * open all day against a pooled hosted database would spend a connection on
 * doing nothing.
 *
 * The cost is exact and worth stating: **a publish on one process is invisible
 * to a stream held by another.** Two instances behind a load balancer would
 * each serve half the staff a connection that quietly misses half the changes.
 * That is why `REALTIME_ENABLED` is off by default and means "this is one
 * process" rather than "I would like live updates", and why the opening frame
 * tells the client whether it may trust what it is about to receive. A second
 * instance wants a driver that goes through Postgres `NOTIFY` or Redis; the
 * shape here does not change when it arrives.
 *
 * ## Nothing here is durable
 *
 * A frame is delivered to whoever is listening at that instant and then it is
 * gone. There is no queue, no replay and no acknowledgement, and none of that
 * is a gap — the frames say only "refetch", the clients poll anyway, and a
 * missed one costs a few seconds of staleness. Anything that must not be lost
 * belongs in the outbox, which is durable precisely because it carries work
 * rather than hints.
 */

/*
 * Pinned to the global so the singleton survives the module graph being
 * evaluated more than once — which Next does in development on every edit, and
 * which would otherwise leave publishers writing to one map while open streams
 * listen to another.
 */
const globalForBroker = globalThis;
const listeners = (globalForBroker.__fzRealtime ??= new Map());

export function isRealtimeEnabled() {
  return env().REALTIME_ENABLED;
}

/**
 * Tells anyone listening that something on this channel changed.
 *
 * Never throws and never waits for anything: it is called from the tail of a
 * request that has already committed, and a listener whose connection died
 * mid-write must not be able to fail the order that triggered it. Returns how
 * many listeners it reached, which is what the e2e suite asserts on.
 */
export function publish(channelName, payload = {}) {
  if (!isRealtimeEnabled()) return 0;

  const set = listeners.get(channelName);
  if (!set?.size) return 0;

  const frame = { channel: channelName, at: new Date().toISOString(), ...payload };
  let delivered = 0;

  for (const listener of [...set]) {
    try {
      listener(frame);
      delivered += 1;
    } catch (error) {
      // A listener that throws is a stream that has gone away without telling
      // us. Drop it rather than letting it break the fan-out to everyone else.
      set.delete(listener);
      logger.debug("dropped a dead realtime listener", { channel: channelName, error: error.message });
    }
  }

  return delivered;
}

/** Publishes the same frame to several channels — an order change is news to more than one. */
export function publishAll(channelNames, payload = {}) {
  let delivered = 0;
  for (const name of new Set(channelNames.filter(Boolean))) delivered += publish(name, payload);
  return delivered;
}

/**
 * Starts listening. Returns the function that stops.
 *
 * The caller is responsible for calling it — the SSE route does so from the
 * stream's `cancel`, which Next invokes when the client disconnects. A leaked
 * listener is a frame written to a closed stream, which is why `publish` also
 * drops anything that throws.
 */
export function subscribe(channelNames, listener) {
  const names = [...new Set(channelNames.filter(Boolean))];

  for (const name of names) {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
  }

  return function unsubscribe() {
    for (const name of names) {
      const set = listeners.get(name);
      if (!set) continue;
      set.delete(listener);
      // Empty sets are removed rather than left behind: channels are keyed by
      // branch and order id, so a long-running server would otherwise
      // accumulate one entry per order it has ever served.
      if (!set.size) listeners.delete(name);
    }
  };
}

/** What is currently connected, for the health endpoint and the test suite. */
export function realtimeStats() {
  let subscribers = 0;
  for (const set of listeners.values()) subscribers += set.size;
  return { enabled: isRealtimeEnabled(), channels: listeners.size, subscribers };
}
