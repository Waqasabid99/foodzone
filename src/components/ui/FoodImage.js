import Image from "next/image";

/**
 * Food photography, or a branded stand-in when there is none.
 *
 * The catalog has no images yet and a real storefront will always have some
 * product without one, so "no image" is a permanent state to design for rather
 * than a temporary gap. A grey box reads as broken; a warm gradient in the
 * brand's own colours reads as deliberate, which is the difference between a
 * page that looks unfinished and one that looks styled.
 *
 * `sizes` is required whenever `fill` is used — without it the browser
 * downloads the largest candidate for every slot, which on a page of cards is
 * megabytes of waste on a phone.
 */
export default function FoodImage({ src, alt, sizes, className = "", priority = false }) {
  if (!src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`bg-gradient-to-br from-secondary-container via-primary-container to-inverse-surface ${className}`}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
    />
  );
}
