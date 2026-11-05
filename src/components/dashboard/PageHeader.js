import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The top of a workspace page: what this screen is, and what you can do here.
 *
 * The actions slot takes whatever the viewer is *allowed* to do, decided by the
 * page. A button that is rendered and then refused on click teaches people to
 * distrust the interface, so an action they cannot perform is not drawn at all.
 */
export default function PageHeader({ title, description = null, back = null, actions = null }) {
  return (
    <header className="flex flex-col gap-3">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-label-bold text-on-surface-variant hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-headline-lg text-on-surface">{title}</h1>
          {description ? (
            <p className="mt-1 text-body-md text-on-surface-variant">{description}</p>
          ) : null}
        </div>

        {/* Wraps rather than holding its full width: a header with a chip and
            two buttons would otherwise push a phone screen sideways. */}
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
