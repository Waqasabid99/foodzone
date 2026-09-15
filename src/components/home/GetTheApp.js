import { Apple, Play } from "lucide-react";

/**
 * The app pitch.
 *
 * The store links are disabled rather than pointing somewhere plausible: there
 * are no published apps yet, and a badge that navigates to a dead App Store
 * page costs more trust than one that visibly is not ready. Swap `href` in when
 * the listings exist.
 */
const STORES = [
  { id: "ios", label: "Download on the", name: "App Store", Icon: Apple, href: null },
  { id: "android", label: "Get it on", name: "Google Play", Icon: Play, href: null },
];

export default function GetTheApp({ storeName }) {
  return (
    <section className="overflow-hidden rounded-banner bg-surface-container">
      <div className="grid items-center gap-8 p-8 md:grid-cols-2 md:p-12">
        <div>
          <h2 className="font-display text-headline-md uppercase text-on-surface md:text-headline-lg">
            Get the app
          </h2>
          <p className="mt-3 max-w-sm text-body-md text-on-surface-variant">
            Download the {storeName} app for exclusive offers, secret menu items, and one-tap
            reordering.
          </p>

          <ul className="mt-6 flex flex-wrap gap-3">
            {STORES.map(({ id, label, name, Icon, href }) => {
              const content = (
                <>
                  <Icon aria-hidden="true" className="size-6 shrink-0" />
                  <span className="text-left leading-tight">
                    <span className="block text-[0.625rem] uppercase tracking-wide opacity-80">{label}</span>
                    <span className="block font-display text-label-bold">{name}</span>
                  </span>
                </>
              );

              const shared =
                "inline-flex items-center gap-3 rounded-field bg-inverse-surface px-4 py-2.5 text-inverse-on-surface";

              return (
                <li key={id}>
                  {href ? (
                    <a
                      href={href}
                      className={`${shared} transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
                    >
                      {content}
                    </a>
                  ) : (
                    <span
                      className={`${shared} cursor-not-allowed opacity-60`}
                      title="Coming soon"
                      aria-disabled="true"
                    >
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* A suggestion of a phone, not a mockup pretending to be a screenshot. */}
        <div className="mx-auto w-full max-w-xs rounded-card bg-primary-container p-6">
          <div className="rounded-md bg-surface-container-lowest p-4 shadow-e2" aria-hidden="true">
            <p className="font-display text-label-bold uppercase text-primary">{storeName}</p>
            <div className="mt-3 h-20 rounded-field bg-surface-container-high" />
            <div className="mt-3 h-2.5 w-3/4 rounded-full bg-surface-container-high" />
            <div className="mt-2 h-2.5 w-1/2 rounded-full bg-surface-container-high" />
          </div>
        </div>
      </div>
    </section>
  );
}
