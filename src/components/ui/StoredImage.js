"use client";

import { useImageRetry } from "@/hooks/useImageRetry";

/**
 * A file from whatever storage this installation was configured with.
 *
 * Deliberately a plain `<img>` rather than `next/image`. The workspace shows
 * uploads from the local driver, S3, R2 or Cloudinary depending on what an
 * operator set up, and `next/image` throws on a host that is not in
 * `remotePatterns` — so optimising these would mean a dashboard that breaks
 * the moment somebody points storage somewhere new. The files were resized and
 * compressed on upload anyway.
 *
 * What it adds over the bare tag is the retry in `useImageRetry`: the same
 * rule the storefront's photography follows, because a thumbnail that fails on
 * a flaky connection is just as stuck, and a media library full of broken
 * icons is a worse lie than an empty one — it suggests the uploads are gone.
 *
 * `fallback` is what to show once the retries are spent. The default is a
 * quiet filled box at whatever size the caller asked for, which is right for a
 * thumbnail in a list; somewhere larger may want to say more.
 */
export default function StoredImage({
  src,
  alt = "",
  className = "",
  loading = "lazy",
  fallback = null,
  onClick,
  onLoad,
}) {
  const retry = useImageRetry(src);

  if (!src || retry.failed) {
    return fallback ?? <div aria-hidden="true" className={`bg-surface-container-high ${className}`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Remounts on each attempt, so the browser starts a fresh request
      // instead of leaving the element in its errored state.
      key={retry.src}
      src={retry.src}
      alt={alt}
      loading={loading}
      onError={retry.onError}
      onLoad={onLoad}
      onClick={onClick}
      className={className}
    />
  );
}
