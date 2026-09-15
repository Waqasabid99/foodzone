/**
 * The footer's "secret sizzle drop codes" signup.
 *
 * Still nothing behind it — there is no subscriber model, no endpoint, and no
 * decision about where addresses should live (a table of our own, or an
 * audience in Resend or Mailchimp). That choice carries consent and deletion
 * obligations, so it is not one to make quietly while restyling a footer.
 *
 * So the form renders and says it is not connected. A field that swallows an
 * address and shows a cheerful confirmation collects nothing while telling the
 * customer it did, which is the one outcome worse than not shipping it. The
 * same treatment as the home page's Bold Club banner — see `BoldClub`.
 *
 * To connect it: add the endpoint, pass `enabled`, and make this a client
 * component that posts through `@/lib/api-client`.
 */
export default function NewsletterForm({ enabled = false, id = "footer-newsletter" }) {
  const statusId = `${id}-status`;

  return (
    <div>
      <p className="font-display text-label-bold uppercase tracking-widest text-inverse-on-surface">
        Get secret sizzle drop codes
      </p>

      <form className="mt-3 flex max-w-sm overflow-hidden rounded-field border border-inverse-on-surface/25">
        <label htmlFor={id} className="sr-only">
          Email address
        </label>
        <input
          id={id}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          disabled={!enabled}
          aria-describedby={enabled ? undefined : statusId}
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-body-md text-inverse-on-surface placeholder:text-inverse-on-surface/50 focus:outline-2 focus:-outline-offset-2 focus:outline-primary-container disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={!enabled}
          className="shrink-0 bg-primary-container px-6 py-3 font-display text-label-bold text-on-primary-container transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-inverse-on-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          Join Club
        </button>
      </form>

      {enabled ? null : (
        <p id={statusId} className="mt-2 text-label-bold font-normal text-inverse-on-surface/60">
          Newsletter signup isn&apos;t connected yet.
        </p>
      )}
    </div>
  );
}
