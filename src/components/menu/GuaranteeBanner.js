import { Bike, ChefHat, CheckCircle2, Flame } from "lucide-react";

/**
 * The prep-time promise.
 *
 * The number is the branch's own configured prep time, passed in — not a "15"
 * written into the markup. A guarantee is the one piece of copy on a menu that
 * has to match what the kitchen is actually set up to do, and a banner that
 * promises fifteen minutes while the branch is configured for twenty-five is a
 * refund request with a countdown on it.
 *
 * With no figure configured the banner does not render at all. Silence is the
 * correct output for a promise nobody has made.
 */
export default function GuaranteeBanner({ minutes, branchName = null }) {
  if (!minutes) return null;

  const steps = [
    { id: "cooking", icon: Flame, label: "Cooking (grill fired)" },
    { id: "way", icon: Bike, label: "On the way" },
    { id: "delivered", icon: CheckCircle2, label: "Delivered" },
  ];

  return (
    <section className="rounded-banner bg-inverse-surface px-6 py-10 text-inverse-on-surface md:px-10">
      <p className="inline-flex items-center gap-2 rounded-full bg-primary-container px-3 py-1 text-label-bold uppercase text-on-primary-container">
        <ChefHat aria-hidden="true" className="size-4" />
        Fast &amp; blazing hot
      </p>

      <h2 className="mt-4 font-display text-headline-md uppercase md:text-headline-lg">
        The {minutes}-minute promise
      </h2>

      <p className="mt-3 max-w-2xl text-body-md opacity-80">
        From the moment the order hits the griddle, we track it to your doorstep or counter — you see
        every stage as it happens.
      </p>

      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 border-t-2 border-primary-container pt-3">
            <step.icon aria-hidden="true" className="size-4 text-primary-container" />
            <span className="text-label-bold uppercase">{step.label}</span>
          </li>
        ))}
      </ol>

      <p className="mt-6 text-label-bold font-normal opacity-60">
        Average prep time{branchName ? ` at ${branchName}` : ""}: {minutes} minutes.
      </p>
    </section>
  );
}
