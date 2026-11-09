"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Asking again for a picture that did not arrive.
 *
 * A photograph fails to load for reasons that have nothing to do with the
 * photograph: a phone changing cells, a CDN hiccup, an optimizer request that
 * timed out. The browser's answer is a broken-image icon that stays broken for
 * the life of the page, because nothing ever requests that URL again — the
 * customer has to know to reload, and on a menu that is the whole page of
 * food.
 *
 * Shared by both image paths rather than living in one of them. Storefront
 * photography goes through `next/image`, which needs its hosts allowlisted;
 * the workspace shows files from whatever storage an operator configured, so
 * those are plain `<img>` and an unlisted host would throw. Two renderers,
 * identical failure, one rule for what to do about it.
 *
 * ## The rules, each of which is a way the naive version goes wrong
 *
 *   * **Retries are bounded.** A genuinely missing file 404s every time, and
 *     retrying it forever would turn one dead image into a stream of requests
 *     from every visitor.
 *   * **Each attempt backs off.** An image that failed because the network is
 *     busy is not helped by being asked again immediately.
 *   * **Each attempt changes the URL.** A browser that has already failed on a
 *     URL will happily fail again from its cache without touching the network,
 *     so the attempt number rides along as a query parameter.
 *   * **Coming back online retries at once**, without spending an attempt: the
 *     usual reason every image on a page failed together is that the
 *     connection went away, and it is back now.
 *
 * Returns the URL to request, whether to stop asking, and the error handler to
 * hand the element. What to show once `failed` is the caller's decision — a
 * storefront card wants the branded gradient a product with no photograph
 * gets, a 40px row in a search result wants something much quieter.
 */

/** Tried this many times in all, then the caller's stand-in. */
export const MAX_ATTEMPTS = 3;

/** Doubling from here: 400ms, then 800ms. */
const BACKOFF_MS = 400;

export function useImageRetry(src) {
  /*
   * Keyed on the src, so an element whose picture changes starts its attempts
   * over without a `setState` in an effect body to clear them.
   */
  const [state, setState] = useState({ src: null, attempt: 0, failed: false });
  const live = state.src === src ? state : { src, attempt: 0, failed: false };

  const timer = useRef(null);

  // Cleanup only: a retry still pending when this unmounts has nothing left
  // to update.
  useEffect(() => () => clearTimeout(timer.current), []);

  /*
   * The connection coming back is better news than any timer, and it does not
   * cost an attempt — the attempts are for a URL that may be genuinely dead,
   * and this was never about the URL.
   */
  useEffect(() => {
    if (!live.failed) return undefined;

    const retry = () => setState({ src, attempt: 0, failed: false });
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [live.failed, src]);

  function onError() {
    const next = live.attempt + 1;

    if (next >= MAX_ATTEMPTS) {
      setState({ src, attempt: next, failed: true });
      return;
    }

    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ src, attempt: next, failed: false }), BACKOFF_MS * 2 ** live.attempt);
  }

  // The attempt rides in the URL so the browser actually asks again rather
  // than replaying the failure it has already cached.
  const separator = src?.includes("?") ? "&" : "?";
  const attemptSrc = src && live.attempt > 0 ? `${src}${separator}retry=${live.attempt}` : src;

  return { src: attemptSrc, failed: live.failed, attempt: live.attempt, onError };
}
