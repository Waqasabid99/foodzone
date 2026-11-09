"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps a screen current, by being told when to refetch and by asking anyway.
 *
 * Both halves matter, and the second one is not a belt-and-braces flourish —
 * it is what makes the first safe to deploy. The live channel is in-process, so
 * a deployment running more than one instance would hand half the staff a
 * connection that misses half the changes. A board that had stopped polling on
 * the strength of a connected stream would go quietly stale, which on a kitchen
 * display means food that nobody knows to cook.
 *
 * So the poll never stops. It slows down — from `fastSeconds` to
 * `slowSeconds` — and only once the server has said, in its opening frame,
 * that it is a single process and may be trusted that far. If the stream never
 * connects, is turned off for this deployment, or drops, the screen is exactly
 * as current as it was before any of this existed.
 *
 * Which also means there is nothing to replay. Every frame says "something on
 * this channel changed" and the answer is always the same: refetch. A frame
 * lost to a dropped connection costs the difference between arriving now and
 * arriving on the next slow tick.
 *
 * `refresh` is called with no arguments and may be async; its result is
 * ignored. It is read from a ref, so a caller that rebuilds the function on
 * every render does not restart the stream — reconnecting once per keystroke is
 * a real hazard here, because the thing being rebuilt is usually a closure over
 * a filter somebody is typing into.
 */
/** How long to wait for more changes before refetching. One action is often several. */
const BURST_MS = 250;

export function useLiveRefresh({
  channels = [],
  refresh,
  /** How often to ask when nothing is pushing. The interval a board had before. */
  fastSeconds = 10,
  /** How often to ask anyway while the stream is trusted. A safety net, not the mechanism. */
  slowSeconds = 90,
  /** False when the deployment has realtime off, so no connection is attempted at all. */
  enabled = true,
}) {
  const [live, setLive] = useState(false);
  const [refused, setRefused] = useState([]);

  /*
   * Updated in an effect rather than during render — writing a ref while
   * rendering is both a lint error here and a real hazard under concurrent
   * rendering, where a render that is thrown away would leave the ref pointing
   * at a closure that never committed.
   */
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  // A stable key, so re-rendering with a freshly built array of the same names
  // does not tear the connection down and put it back up.
  const key = [...channels].filter(Boolean).sort().join(",");

  useEffect(() => {
    if (!enabled || !key) return undefined;

    // `EventSource` carries the session cookie on its own. There is no header
    // to set, which is the one real constraint of the transport and the reason
    // the endpoint accepts a cookie rather than only a bearer token.
    const source = new EventSource(`/api/v1/realtime/stream?channels=${encodeURIComponent(key)}`);
    let burst = null;

    source.addEventListener("hello", (event) => {
      try {
        const hello = JSON.parse(event.data);
        // Trust is granted by the server, never assumed by the client.
        setLive(Boolean(hello.authoritative));
        setRefused(hello.refused ?? []);
      } catch {
        setLive(false);
      }
    });

    /*
     * Coalesced, because one action is often several changes.
     *
     * Bumping a ticket moves every line on it, and each line is its own
     * change — so a six-line ticket would otherwise fire six frames and six
     * refetches of the same board, within a few milliseconds of each other.
     * A short trailing wait collapses any such burst into one fetch, and the
     * same wait protects a busy branch where separate orders genuinely do move
     * at once. It is trailing rather than leading so the fetch happens after
     * the last change rather than before it.
     */
    source.addEventListener("change", () => {
      clearTimeout(burst);
      burst = setTimeout(() => latest.current?.(), BURST_MS);
    });

    // The server ends a stream on purpose every so often rather than holding a
    // socket open forever. `EventSource` reconnects by itself; dropping out of
    // live until it does means the poll speeds back up in the meantime.
    source.addEventListener("bye", () => setLive(false));
    source.addEventListener("error", () => setLive(false));

    return () => {
      clearTimeout(burst);
      source.close();
      setLive(false);
    };
  }, [key, enabled]);

  /*
   * One timer whose period depends on whether anything is pushing. Separate
   * from the stream effect so a reconnect does not reset the poll clock, which
   * would let a flapping connection postpone the safety net indefinitely.
   */
  useEffect(() => {
    const seconds = live ? slowSeconds : fastSeconds;
    const timer = setInterval(() => latest.current?.(), seconds * 1000);
    return () => clearInterval(timer);
  }, [live, fastSeconds, slowSeconds]);

  return { live, refused };
}
