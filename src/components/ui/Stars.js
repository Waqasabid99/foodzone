import { Star } from "lucide-react";

/**
 * A star rating.
 *
 * The stars are decorative — the rating is announced once, as text, so a screen
 * reader says "rated 5 out of 5" instead of reading the word "star" five times.
 */
export default function Stars({ rating, className = "" }) {
  const filled = Math.round(Number(rating) || 0);

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <span className="sr-only">{`Rated ${filled} out of 5`}</span>
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          aria-hidden="true"
          className={`size-4 ${position <= filled ? "fill-tertiary-container text-tertiary-container" : "text-outline-variant"}`}
        />
      ))}
    </span>
  );
}
