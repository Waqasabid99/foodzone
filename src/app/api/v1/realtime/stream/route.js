import { z } from "zod";
import { apiHandler, RateLimits } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { authorizeChannels, orderIdsIn } from "@/server/realtime/channels";
import { isRealtimeEnabled, subscribe } from "@/server/realtime/broker";

/**
 * One long-lived connection that says when to refetch.
 *
 * Server-sent events rather than a WebSocket, for three reasons that all point
 * the same way. The traffic is one-directional — the client has nothing to say
 * back that an ordinary request would not carry better. It is plain HTTP, so it
 * inherits the cookie session, the bearer token, the rate limiter and the
 * `apiHandler` guards instead of needing a parallel auth path. And the browser
 * reconnects on its own, which for a protocol whose every message means
 * "refetch" is the entire recovery story.
 *
 * ## The opening frame is a promise about the transport
 *
 * `hello` carries `authoritative`. True means the operator has asserted this is
 * a single process (`REALTIME_ENABLED`), so every publisher and every stream
 * are in the same memory and a client may safely slow its polling right down.
 * Clients must not assume it: across two instances the in-memory broker would
 * hand half the staff a connection that misses half the changes, and a board
 * that had stopped polling on the strength of it would go quietly stale. The
 * server knows which deployment it is; the client cannot, so it is told.
 *
 * ## Why it closes itself
 *
 * A stream is held for `REALTIME_MAX_MINUTES` and then ends with a `bye`.
 * Connections do not die cleanly — a laptop lid, a phone sleeping, a proxy
 * reaping idle sockets — and without a ceiling those all become listeners the
 * process believes are live. A bounded stream turns an unbounded leak into one
 * reconnect per half hour, which EventSource does without being asked.
 */
const querySchema = z.object({
  /** Comma-separated, because `EventSource` can only ever send a URL. */
  channels: z.string().min(1).max(2_000),
});

/** Comments, not events: they keep the socket warm without the client seeing anything. */
const HEARTBEAT_MS = 25_000;

function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const GET = apiHandler(
  {
    auth: true,
    query: querySchema,
    // Generous: a dashboard with several boards open reconnects every half hour
    // per tab, and a reaped proxy connection reconnects sooner than that.
    rateLimit: RateLimits.session,
    doc: {
      summary: "Subscribe to live change notifications",
      tag: "Realtime",
      description:
        "Server-sent events. Each frame names a channel that changed; refetch through the ordinary endpoint. " +
        "Returns 204 when realtime is disabled for this deployment, which tells the client to keep polling.",
    },
  },
  async ({ auth, query, request }) => {
    // 204 rather than an error: `EventSource` treats a response that is not
    // `text/event-stream` as a permanent failure and stops retrying, which is
    // exactly right when the answer is "this deployment does not do this".
    if (!isRealtimeEnabled()) return new Response(null, { status: 204 });

    const requested = query.channels.split(",").map((name) => name.trim()).filter(Boolean);

    /*
     * Which of the named orders are actually this caller's.
     *
     * Ownership is a row rather than a permission, so it takes a read — but
     * only of the ids they asked about, and only to compare against their own
     * user id. Staff watch orders through their branch channel instead, which
     * is a permission check and needs no query at all.
     */
    const orderIds = orderIdsIn(requested);
    const ownOrders = orderIds.length
      ? await prisma.order.findMany({
          where: { id: { in: orderIds }, userId: auth.userId },
          select: { id: true },
        })
      : [];

    const { allowed, refused } = authorizeChannels({
      principal: auth,
      requested,
      allowedOrderIds: ownOrders.map((order) => order.id),
    });

    if (!allowed.length) {
      // Holding a connection that can never deliver anything is worse than
      // refusing it: the client would wait on it instead of falling back.
      return new Response(null, { status: 204 });
    }

    const maxMs = env().REALTIME_MAX_MINUTES * 60_000;
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat = null;
    let ceiling = null;

    const stream = new ReadableStream({
      start(controller) {
        let open = true;

        const send = (text) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The client has gone. Stop writing and let `cancel` clean up.
            open = false;
          }
        };

        const close = (reason) => {
          if (!open) return;
          send(frame("bye", { reason }));
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed by the client disconnecting */
          }
        };

        send(
          frame("hello", {
            // What the client may trust. See the note above: this is a
            // statement about the deployment, not a capability check.
            authoritative: true,
            channels: allowed,
            // Named so a board can say "you are not allowed to watch the
            // kitchen" rather than appearing to work and never updating.
            refused,
            maxSeconds: Math.floor(maxMs / 1000),
          }),
        );

        unsubscribe = subscribe(allowed, (payload) => send(frame("change", payload)));

        // A bare comment. Proxies and load balancers reap idle connections,
        // and the client cannot tell a quiet kitchen from a dead socket.
        heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
        heartbeat.unref?.();

        ceiling = setTimeout(() => close("MAX_DURATION"), maxMs);
        ceiling.unref?.();

        request.signal?.addEventListener("abort", () => {
          open = false;
        });
      },

      cancel() {
        // Next calls this when the client disconnects. Everything the stream
        // holds is released here, and `publish` drops a listener that throws,
        // so a missed cancel costs one frame rather than a permanent leak.
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(ceiling);
        logger.debug("realtime stream closed", { userId: auth.userId, channels: allowed.length });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        // `no-transform` matters as much as `no-cache`: a proxy that gzips this
        // will buffer it, and a buffered stream is a stream that never arrives.
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        // nginx specifically. Without it the default proxy buffer holds frames
        // back until it fills, which for 60-byte frames is never.
        "X-Accel-Buffering": "no",
      },
    });
  },
);
