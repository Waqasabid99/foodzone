import { Bike, Flame, Pointer } from "lucide-react";

/**
 * Three steps, on the dark panel that anchors the page.
 *
 * The numbering lives in the visible text ("1. Order Bold") rather than only in
 * the layout, so the sequence survives being read out or reflowed onto one
 * column on a phone.
 */
const ICONS = { pointer: Pointer, flame: Flame, bike: Bike };

export default function HowItWorks({ steps }) {
  return (
    <section className="rounded-banner bg-inverse-surface px-6 py-12 md:px-12">
      <h2 className="text-center font-display text-headline-md uppercase text-primary-container md:text-headline-lg">
        How it works
      </h2>

      <ol className="mx-auto mt-10 grid max-w-4xl gap-10 sm:grid-cols-3">
        {steps.map((step) => {
          const Icon = ICONS[step.icon] ?? Pointer;

          return (
            <li key={step.id} className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary-container">
                <Icon aria-hidden="true" className="size-6 text-on-primary-container" />
              </span>
              <h3 className="mt-4 font-display text-body-lg text-inverse-on-surface">
                {step.step}. {step.title}
              </h3>
              <p className="mt-2 text-body-md text-inverse-on-surface/70">{step.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
