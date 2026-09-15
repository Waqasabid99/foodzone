import Link from "next/link";

/**
 * The wordmark.
 *
 * Two weights of one word, which is the whole identity — so it is a component
 * rather than markup repeated in the header and the footer, where the two would
 * inevitably drift apart.
 */
export default function Logo({ name = "FoodZone", className = "" }) {
  const [head, ...rest] = name.split(/(?=[A-Z])/);

  return (
    <Link
      href="/"
      className={`font-display text-headline-md uppercase tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
    >
      <span className="text-primary">{head}</span>
      <span className="text-on-surface">{rest.join("")}</span>
    </Link>
  );
}
