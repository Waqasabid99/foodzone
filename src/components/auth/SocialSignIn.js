/**
 * Google and Apple sign-in.
 *
 * Nothing is behind these. There is no OAuth provider configured, no callback
 * route, and no account-linking rule for the case that matters most — someone
 * who registered with a password and later arrives through Google on the same
 * address. Getting that wrong either locks people out of their own account or
 * hands an account to whoever controls the address at the provider, so it is a
 * decision to make deliberately rather than a button to wire up.
 *
 * Until then the buttons render disabled and say why, the same way the App
 * Store badges and the newsletter form do. A social button that silently does
 * nothing is worse than an absent one: the visitor concludes the site is broken
 * and leaves, rather than using the email form sitting right beneath it.
 *
 * `divider` says which side of the buttons the "or continue with" rule sits on,
 * because it has to point at the email form — below the buttons when they come
 * first, above them when they come last.
 */
export default function SocialSignIn({ enabled = false, label = "Or continue with", divider = "below" }) {
  const rule = (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-outline-variant" />
      <span className="text-label-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
      <span className="h-px flex-1 bg-outline-variant" />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {divider === "above" ? rule : null}

      <div className="grid grid-cols-2 gap-3">
        <ProviderButton enabled={enabled} name="Google" />
        <ProviderButton enabled={enabled} name="Apple" />
      </div>

      {enabled ? null : (
        <p id="social-signin-status" className="text-center text-label-bold font-normal text-on-surface-variant">
          Google and Apple sign-in aren&apos;t connected yet — use the email form instead.
        </p>
      )}

      {divider === "below" ? rule : null}
    </div>
  );
}

function ProviderButton({ enabled, name }) {
  return (
    <button
      type="button"
      disabled={!enabled}
      aria-describedby={enabled ? undefined : "social-signin-status"}
      className="flex items-center justify-center gap-2 rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      {/* No brand logos: shipping a redrawn Google or Apple mark next to a
          button that does not perform their sign-in flow misrepresents both,
          and each has brand guidelines that govern its use. The name carries
          the meaning until the real integration lands. */}
      {name}
    </button>
  );
}
