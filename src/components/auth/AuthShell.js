import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";

/**
 * The two-column frame both auth pages sit in: brand on one side, form on the
 * other.
 *
 * The form comes first in the DOM and the brand panel second, always. `side`
 * only repaints them with `order-*`, which the design alternates between
 * signing in and signing up so the two pages read differently at a glance.
 * Keeping the source order fixed means tab order and screen-reader order start
 * at the thing the visitor came here to do, whichever way the columns look —
 * which is the whole reason to reach for `order-*` rather than swapping markup.
 *
 * Below `lg` the panel is dropped rather than stacked above the form. On a
 * phone, atmosphere above the fold means scrolling past it to reach the email
 * box every single time.
 */
export default function AuthShell({
  side = "left",
  eyebrow,
  headline,
  children,
  panel = null,
  imageUrl = null,
}) {
  const brandOnLeft = side === "left";

  return (
    <div className="mx-auto grid max-w-page items-stretch lg:grid-cols-2">
      {/* Form panel — first in the DOM on every variant. */}
      <section
        className={`flex flex-col justify-center bg-surface px-margin-mobile py-12 md:px-margin-desktop ${
          brandOnLeft ? "lg:order-2" : "lg:order-1"
        }`}
      >
        <div className="mx-auto w-full max-w-md">{children}</div>
      </section>

      {/* Brand panel. `hidden` rather than visually-hidden: it is atmosphere
          plus a restatement of what the form already says, and on a narrow
          screen it costs more than it gives. */}
      <section
        className={`relative isolate hidden overflow-hidden px-10 py-16 lg:flex lg:flex-col lg:justify-center ${
          brandOnLeft ? "lg:order-1" : "lg:order-2"
        }`}
      >
        <div className="absolute inset-0 -z-10">
          <FoodImage src={imageUrl} alt="" sizes="(max-width: 1024px) 0px, 640px" className="size-full" />
          {/* The copy sits on photography, so it carries its own scrim rather
              than trusting whatever image ends up behind it. */}
          <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/70 to-black/45" />
        </div>

        {eyebrow ? (
          <p className="text-label-bold uppercase tracking-widest text-primary-container">{eyebrow}</p>
        ) : null}

        <h2 className="mt-3 max-w-md font-display text-headline-lg uppercase leading-none text-white">
          {headline}
        </h2>

        {panel}
      </section>
    </div>
  );
}

/** The "← Back" / status-chip row above every auth form. */
export function AuthTopBar({ chip = null, backHref = "/", backLabel = "Back to Home" }) {
  return (
    <div className="mb-8 flex items-center justify-between gap-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-body-md text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {backLabel}
      </Link>

      {chip ? (
        <span className="rounded-full bg-primary-container px-3 py-1 text-label-bold text-on-primary-container">
          {chip}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The little feature grid inside a brand panel.
 *
 * Icons are `aria-hidden` and the text carries the meaning, so nothing here
 * depends on recognising a glyph.
 */
export function AuthPerks({ items, layout = "grid" }) {
  const stacked = layout === "stack";

  return (
    <ul className={`mt-10 grid gap-3 ${stacked ? "" : "sm:grid-cols-3"}`}>
      {items.map(({ id, icon: Icon, title, body }) => (
        <li
          key={id}
          className={`rounded-card bg-white/10 p-4 backdrop-blur-sm ${
            stacked ? "flex items-start gap-3" : ""
          }`}
        >
          <Icon
            aria-hidden="true"
            className={`size-5 shrink-0 text-primary-container ${stacked ? "mt-0.5" : ""}`}
          />
          <span className="block">
            <span className={`block font-display text-label-bold uppercase text-white ${stacked ? "" : "mt-2"}`}>
              {title}
            </span>
            <span className="mt-1 block text-label-bold font-normal leading-snug text-white/75">
              {body}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reassurance strip under a form: three short claims about how the thing
 * works.
 *
 * Each one has to be true of this system specifically, which is why the copy is
 * passed in rather than written here — the verification page's middle item is
 * the configured code lifetime, and that is a setting, not a slogan.
 */
export function AuthAssurances({ items }) {
  return (
    <ul className="mt-8 grid gap-4 border-t border-outline-variant pt-6 sm:grid-cols-3">
      {items.map(({ id, icon: Icon, title, body }) => (
        <li key={id} className="flex items-start gap-2">
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span className="block text-label-bold uppercase leading-tight text-on-surface">{title}</span>
            <span className="block text-label-bold font-normal leading-tight text-on-surface-variant">
              {body}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
