import Image from "next/image";
import { isLocalMediaUrl } from "@/lib/media-url";

/**
 * Food photography, or a branded stand-in when there is none.
 *
 * The catalog has no images yet and a real storefront will always have some
 * product without one, so "no image" is a permanent state to design for rather
 * than a temporary gap. A grey box reads as broken; a warm gradient in the
 * brand's own colours reads as deliberate, which is the difference between a
 * page that looks unfinished and one that looks styled.
 *
 * `position` is where the crop holds on when the box and the photograph are
 * different shapes. It defaults to the centre, which is right for a square-ish
 * card; a wide band showing a tall photograph often is not.
 *
 * `sizes` is required whenever `fill` is used — without it the browser
 * downloads the largest candidate for every slot, which on a page of cards is
 * megabytes of waste on a phone.
 */
export default function FoodImage({ src, alt, sizes, className = "", priority = false, position = "object-center" }) {
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
