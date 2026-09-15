/**
 * A section title, in the billboard voice the brand asks for.
 *
 * `action` is the optional link that sits opposite it — "see all", a handle —
 * so every section headline is laid out the same way without each one
 * re-inventing the row.
 */
export default function SectionHeading({ title, action = null, className = "" }) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <h2 className="font-display text-headline-md uppercase text-on-surface md:text-headline-lg">{title}</h2>
      {action}
    </div>
  );
}
