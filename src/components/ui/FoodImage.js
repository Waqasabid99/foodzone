"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { isLocalMediaUrl } from "@/lib/media-url";

/**
 * Food photography, or a branded stand-in when there is none — or when it
 * does not arrive.
 *
 * The catalog has no images yet and a real storefront will always have some
 * product without one, so "no image" is a permanent state to design for rather
 * than a temporary gap. A grey box reads as broken; a warm gradient in the
 * brand's own colours reads as deliberate, which is the difference between a
 * page that looks unfinished and one that looks styled.
 *
 * ## Why this is a client component
 *
 * A photograph that fails to load is not a rare event: a phone changing cells,
 * a CDN hiccup, an optimizer request that times out. The browser's answer is a
 * broken-image icon that stays broken for the life of the page, because
 * nothing ever asks for that URL again — the customer has to know to reload,
 * and on a menu that is the whole page of food.
 *
 * So a failure is retried here, and the cost is that every page using this
 * ships a little JavaScript. That is the trade: the alternative is a storefront
 * whose pictures sometimes just do not come back.
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
 *   * **Giving up is not a broken icon.** It falls back to the same branded
 *     gradient a product with no photograph gets, so the worst case looks
 *     styled rather than broken.
 *
 * `position` is where the crop holds on when the box and the photograph are
 * different shapes. It defaults to the centre, which is right for a square-ish
 * card; a wide band showing a tall photograph often is not.
 *
 * `sizes` is required whenever `fill` is used — without it the browser
 * downloads the largest candidate for every slot, which on a page of cards is
 * megabytes of waste on a phone.
 */

/** Tried this many times in all, then the stand-in. */
const MAX_ATTEMPTS = 3;

/** Doubling from here: 400ms, then 800ms. */
const BACKOFF_MS = 400;

const PLACEHOLDER = "bg-gradient-to-br from-secondary-container via-primary-container to-inverse-surface";

export default function FoodImage({ src, alt, sizes, className = "", priority = false, position = "object-center" }) {
  /*
   * Keyed on the src, so a card whose photograph changes starts its attempts
   * over without a `setState` in an effect body to clear them — the same way
   * the checkout keys its quote.
   */
  const [state, setState] = useState({ src: null, attempt: 0, failed: false });
  const live = state.src === src ? state : { src, attempt: 0, failed: false };

  const timer = useRef(null);

  // Cleanup only: a retry still pending when the card unmounts has nothing
  // left to update.
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

  if (!src || live.failed) {
    return <div role="img" aria-label={alt} className={`${PLACEHOLDER} ${className}`} />;
  }

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
  const separator = src.includes("?") ? "&" : "?";
  const attemptSrc = live.attempt > 0 ? `${src}${separator}retry=${live.attempt}` : src;

  return (
    <Image
      // Remounts on each attempt, so the browser starts a fresh request
      // instead of leaving the element in its errored state.
      key={attemptSrc}
      src={attemptSrc}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      onError={onError}
      // Files from the local storage driver load straight from our own API.
      // The optimizer would fetch them from this server's own host, which
      // Next refuses for a private address like localhost unless
      // `dangerouslyAllowLocalIP` is on — an SSRF hole not worth opening. They
      // were already resized and compressed before upload.
      unoptimized={isLocalMediaUrl(src)}
      className={`object-cover ${position} ${className}`}
    />
  );
}
