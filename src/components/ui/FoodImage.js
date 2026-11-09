"use client";

import Image from "next/image";
import { isLocalMediaUrl } from "@/lib/media-url";
import { useImageRetry } from "@/hooks/useImageRetry";

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
 * A photograph that fails to load is retried — see `useImageRetry` for why and
 * how often — and the same gradient catches it when the retries run out, so
 * the worst case still looks styled rather than broken. That is also why this
 * is a client component: the cost is a little JavaScript on every page that
 * shows food, and the alternative is pictures that sometimes just do not come
 * back until somebody reloads.
 *
 * `position` is where the crop holds on when the box and the photograph are
 * different shapes. It defaults to the centre, which is right for a square-ish
 * card; a wide band showing a tall photograph often is not.
 *
 * `sizes` is required whenever `fill` is used — without it the browser
 * downloads the largest candidate for every slot, which on a page of cards is
 * megabytes of waste on a phone.
 */
const PLACEHOLDER = "bg-gradient-to-br from-secondary-container via-primary-container to-inverse-surface";

export default function FoodImage({ src, alt, sizes, className = "", priority = false, position = "object-center" }) {
  const retry = useImageRetry(src);

  if (!src || retry.failed) {
    return <div role="img" aria-label={alt} className={`${PLACEHOLDER} ${className}`} />;
  }

  return (
    <Image
      // Remounts on each attempt, so the browser starts a fresh request
      // instead of leaving the element in its errored state.
      key={retry.src}
      src={retry.src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      onError={retry.onError}
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
