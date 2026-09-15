/**
 * The newsletter banner.
 *
 * Nothing is wired behind it. There is no subscriber model, no endpoint, and no
 * decision yet about where addresses should live — a table of our own, or an
 * audience in Resend or Mailchimp. That is a choice with consent and deletion
 * obligations attached, so it is not one to make silently while building a
 * banner.
 *
 * Until it is made, the form renders but does not accept submissions, and says
 * so. The alternative — a field that swallows an address and shows a cheerful
 * toast — collects nothing while telling the customer it did, which is the one
 * outcome worse than not shipping it.
 *
 * To connect it: add the endpoint, set `enabled`, and make this a client
 * component that posts through `@/lib/api-client`.
 */
export default function BoldClub({ enabled = false }) {
  return (
    <section className="rounded-banner bg-gradient-to-r from-secondary via-primary to-primary-container px-6 py-12 text-center md:px-12">
      <h2 className="font-display text-headline-md uppercase text-white md:text-headline-lg">
        Join the Bold Club
      </h2>
      <p className="mt-3 text-body-md text-white/90">
        Subscribe to our newsletter and get a free side of fries with your next order.
      </p>

      <form
        className="mx-auto mt-6 flex max-w-lg flex-col gap-3 sm:flex-row"
        aria-describedby={enabled ? undefined : "bold-club-status"}
      >
        <label htmlFor="bold-club-email" className="sr-only">
          Email address
        </label>
        <input
          id="bold-club-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          disabled={!enabled}
          className="min-w-0 flex-1 rounded-full bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-2 focus:outline-offset-2 focus:outline-white disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={!enabled}
          className="rounded-full bg-inverse-surface px-8 py-3 font-display text-label-bold text-inverse-on-surface transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Sign Up Now
        </button>
      </form>

      {enabled ? null : (
        <p id="bold-club-status" className="mt-3 text-label-bold text-white/80">
          Newsletter signup isn&apos;t connected yet.
        </p>
      )}
    </section>
  );
}
