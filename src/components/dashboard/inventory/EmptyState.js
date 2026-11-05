import Link from "next/link";

/** What an empty list means, and the one thing to do about it. */
export default function EmptyState({ icon: Icon, title, children, action = null }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-14 text-center">
      {Icon ? <Icon aria-hidden="true" className="size-8 text-on-surface-variant" /> : null}
      <p className="font-display text-headline-md text-on-surface">{title}</p>
      {children ? <div className="max-w-md text-body-md text-on-surface-variant">{children}</div> : null}
      {action ? (
        <Link href={action.href} className="text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
