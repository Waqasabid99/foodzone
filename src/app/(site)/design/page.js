import ThemeToggle from "@/components/theme/ThemeToggle";

/**
 * The theme, rendered.
 *
 * Every role, type step, radius and elevation on one page, in whichever theme
 * is active. Two jobs: it is the reference to build components against, and it
 * is the only way to actually *see* that a token pair works — a contrast ratio
 * passing in `npm run check:contrast` still tells you nothing about whether the
 * mustard chip looks right next to the orange button.
 *
 * It also pins the utilities: Tailwind only emits classes it finds in the
 * source, so this page is what proves `rounded-card`, `text-display-lg` and
 * `shadow-e2` resolve to the spec's values rather than silently to nothing.
 */

const SURFACE_ROLES = [
  ["surface", "on-surface"],
  ["surface-dim", "on-surface"],
  ["surface-bright", "on-surface"],
  ["surface-container-lowest", "on-surface"],
  ["surface-container-low", "on-surface"],
  ["surface-container", "on-surface"],
  ["surface-container-high", "on-surface"],
  ["surface-container-highest", "on-surface"],
  ["surface-variant", "on-surface-variant"],
  ["inverse-surface", "inverse-on-surface"],
];

const BRAND_ROLES = [
  ["primary", "on-primary"],
  ["primary-container", "on-primary-container"],
  ["secondary", "on-secondary"],
  ["secondary-container", "on-secondary-container"],
  ["tertiary", "on-tertiary"],
  ["tertiary-container", "on-tertiary-container"],
];

const SEMANTIC_ROLES = [
  ["error", "on-error"],
  ["error-container", "on-error-container"],
  ["success", "on-success"],
  ["success-container", "on-success-container"],
  ["warning", "on-warning"],
  ["warning-container", "on-warning-container"],
];

const FIXED_ROLES = [
  ["primary-fixed", "on-primary-fixed"],
  ["primary-fixed-dim", "on-primary-fixed-variant"],
  ["secondary-fixed", "on-secondary-fixed"],
  ["secondary-fixed-dim", "on-secondary-fixed-variant"],
  ["tertiary-fixed", "on-tertiary-fixed"],
  ["tertiary-fixed-dim", "on-tertiary-fixed-variant"],
];

/**
 * Tailwind reads class names as literal strings, so a swatch cannot build
 * `bg-${role}` at runtime — the class would never be emitted. The map is the
 * price of that, and it is why every role appears here spelled out.
 */
const BG = {
  surface: "bg-surface",
  "surface-dim": "bg-surface-dim",
  "surface-bright": "bg-surface-bright",
  "surface-container-lowest": "bg-surface-container-lowest",
  "surface-container-low": "bg-surface-container-low",
  "surface-container": "bg-surface-container",
  "surface-container-high": "bg-surface-container-high",
  "surface-container-highest": "bg-surface-container-highest",
  "surface-variant": "bg-surface-variant",
  "inverse-surface": "bg-inverse-surface",
  primary: "bg-primary",
  "primary-container": "bg-primary-container",
  secondary: "bg-secondary",
  "secondary-container": "bg-secondary-container",
  tertiary: "bg-tertiary",
  "tertiary-container": "bg-tertiary-container",
  error: "bg-error",
  "error-container": "bg-error-container",
  success: "bg-success",
  "success-container": "bg-success-container",
  warning: "bg-warning",
  "warning-container": "bg-warning-container",
  "primary-fixed": "bg-primary-fixed",
  "primary-fixed-dim": "bg-primary-fixed-dim",
  "secondary-fixed": "bg-secondary-fixed",
  "secondary-fixed-dim": "bg-secondary-fixed-dim",
  "tertiary-fixed": "bg-tertiary-fixed",
  "tertiary-fixed-dim": "bg-tertiary-fixed-dim",
};

const FG = {
  "on-surface": "text-on-surface",
  "on-surface-variant": "text-on-surface-variant",
  "inverse-on-surface": "text-inverse-on-surface",
  "on-primary": "text-on-primary",
  "on-primary-container": "text-on-primary-container",
  "on-secondary": "text-on-secondary",
  "on-secondary-container": "text-on-secondary-container",
  "on-tertiary": "text-on-tertiary",
  "on-tertiary-container": "text-on-tertiary-container",
  "on-error": "text-on-error",
  "on-error-container": "text-on-error-container",
  "on-success": "text-on-success",
  "on-success-container": "text-on-success-container",
  "on-warning": "text-on-warning",
  "on-warning-container": "text-on-warning-container",
  "on-primary-fixed": "text-on-primary-fixed",
  "on-primary-fixed-variant": "text-on-primary-fixed-variant",
  "on-secondary-fixed": "text-on-secondary-fixed",
  "on-secondary-fixed-variant": "text-on-secondary-fixed-variant",
  "on-tertiary-fixed": "text-on-tertiary-fixed",
  "on-tertiary-fixed-variant": "text-on-tertiary-fixed-variant",
};

function Swatch({ background, foreground }) {
  return (
    <div
      className={`${BG[background]} ${FG[foreground]} rounded-card border border-outline-variant p-4`}
    >
      <p className="text-label-bold">{background}</p>
      <p className="mt-1 text-label-bold opacity-80">{foreground}</p>
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="mt-16 first:mt-0">
      <h2 className="text-headline-md font-display text-on-surface">{title}</h2>
      {description ? <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export const metadata = {
  title: "Sizzle & Snap — FoodZone design tokens",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return (
    <div className="mx-auto max-w-page px-margin-mobile py-16 md:px-margin-desktop">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-label-bold uppercase tracking-widest text-primary">Sizzle &amp; Snap</p>
          <h1 className="mt-2 text-headline-lg-mobile font-display text-on-surface md:text-headline-lg">
            FoodZone design tokens
          </h1>
          <p className="mt-3 max-w-2xl text-body-lg text-on-surface-variant">
            Every colour role, type step, radius and elevation in the system. Components should use
            role names — never raw hex — so switching the theme swaps the values underneath them.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section
        title="Surfaces"
        description="Tonal layering, lowest to highest. Elevation in this system is carried by surface tone first and shadow second."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SURFACE_ROLES.map(([background, foreground]) => (
            <Swatch key={background} background={background} foreground={foreground} />
          ))}
        </div>
      </Section>

      <Section
        title="Brand"
        description="Energetic Orange leads. Ketchup Red is for urgency, Mustard Yellow for badges. The saturated containers hold their value in both themes — that punch is the brand."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND_ROLES.map(([background, foreground]) => (
            <Swatch key={background} background={background} foreground={foreground} />
          ))}
        </div>
      </Section>

      <Section title="Semantic" description="Outcomes, not brand. Reach for these only when the meaning is success, failure or caution.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SEMANTIC_ROLES.map(([background, foreground]) => (
            <Swatch key={background} background={background} foreground={foreground} />
          ))}
        </div>
      </Section>

      <Section
        title="Fixed"
        description="Identical in both themes by definition. For surfaces that must not change with the theme — a promo banner that has to match printed artwork, say."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIXED_ROLES.map(([background, foreground]) => (
            <Swatch key={background} background={background} foreground={foreground} />
          ))}
        </div>
      </Section>

      <Section title="Typography" description="Montserrat for the billboard headlines, Chivo for everything that has to be read.">
        <div className="space-y-6 rounded-card bg-surface-container-low p-6">
          <div>
            <p className="text-label-bold text-on-surface-variant">text-display-lg · Montserrat 900 · 64px</p>
            <p className="font-display text-display-lg text-on-surface">Fast food, faster</p>
          </div>
          <div>
            <p className="text-label-bold text-on-surface-variant">text-headline-lg · Montserrat 800 · 40px</p>
            <p className="font-display text-headline-lg text-on-surface">Today&apos;s hot deals</p>
          </div>
          <div>
            <p className="text-label-bold text-on-surface-variant">
              text-headline-lg-mobile · Montserrat 800 · 32px
            </p>
            <p className="font-display text-headline-lg-mobile text-on-surface">Today&apos;s hot deals</p>
          </div>
          <div>
            <p className="text-label-bold text-on-surface-variant">text-headline-md · Montserrat 700 · 24px</p>
            <p className="font-display text-headline-md text-on-surface">Double Smash Burger</p>
          </div>
          <div>
            <p className="text-label-bold text-on-surface-variant">text-body-lg · Chivo 400 · 18px</p>
            <p className="text-body-lg text-on-surface">
              Two smashed patties, melted cheese, house sauce, toasted brioche.
            </p>
          </div>
          <div>
            <p className="text-label-bold text-on-surface-variant">text-body-md · Chivo 400 · 16px</p>
            <p className="text-body-md text-on-surface">
              Two smashed patties, melted cheese, house sauce, toasted brioche.
            </p>
          </div>
          <div>
            <p className="text-label-bold text-on-surface-variant">text-label-bold · Chivo 700 · 14px</p>
            <p className="text-label-bold text-on-surface">ADD TO CART</p>
          </div>
        </div>
      </Section>

      <Section title="Shape" description="Rounded and bite-sized. Names say what each radius is for, because bare `rounded` cannot be re-pointed to the spec's 0.5rem.">
        <div className="flex flex-wrap gap-4">
          {[
            ["rounded-sm", "rounded-sm", "0.25rem"],
            ["rounded-field", "rounded-field", "0.5rem"],
            ["rounded-md", "rounded-md", "0.75rem"],
            ["rounded-card", "rounded-card", "1rem"],
            ["rounded-banner", "rounded-banner", "1.5rem"],
            ["rounded-full", "rounded-full", "9999px"],
          ].map(([label, className, value]) => (
            <div key={label} className="text-center">
              <div className={`size-24 bg-primary-container ${className}`} />
              <p className="mt-2 text-label-bold text-on-surface">{label}</p>
              <p className="text-label-bold text-on-surface-variant">{value}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Elevation" description="Warm-tinted ambient shadows — never harsh black, so the page keeps its food-centric warmth.">
        <div className="flex flex-wrap gap-8">
          {[
            ["shadow-e1", "shadow-e1", "Cards"],
            ["shadow-e2", "shadow-e2", "Hover / interactive"],
            ["shadow-e3", "shadow-e3", "Sticky bars and modals"],
          ].map(([label, className, use]) => (
            <div key={label} className={`w-56 rounded-card bg-surface-container-lowest p-6 ${className}`}>
              <p className="text-label-bold text-on-surface">{label}</p>
              <p className="mt-1 text-label-bold text-on-surface-variant">{use}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Components" description="The treatments the spec names, built from the roles above.">
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="rounded-field bg-primary-container px-8 py-3 font-display text-label-bold text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              PRIMARY
            </button>
            <button
              type="button"
              className="rounded-field bg-inverse-surface px-8 py-3 font-display text-label-bold text-inverse-on-surface transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              ADD TO CART
            </button>
            <button
              type="button"
              className="rounded-field border-2 border-on-surface px-8 py-3 font-display text-label-bold text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              GHOST
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <span className="rounded-full bg-primary-container px-4 py-2 text-label-bold text-on-primary-container">
              Burgers
            </span>
            {["Sides", "Pizza", "Drinks"].map((label) => (
              <span
                key={label}
                className="rounded-full bg-surface-container-high px-4 py-2 text-label-bold text-on-surface-variant"
              >
                {label}
              </span>
            ))}
            <span className="rounded-full bg-tertiary-container px-4 py-2 text-label-bold text-on-tertiary-container">
              New
            </span>
            <span className="rounded-full bg-secondary-container px-4 py-2 text-label-bold text-on-secondary-container">
              Hot deal
            </span>
          </div>

          <div className="max-w-sm">
            <label htmlFor="demo-field" className="block text-label-bold text-on-surface">
              Delivery address
            </label>
            <input
              id="demo-field"
              type="text"
              placeholder="221B Baker Street"
              className="mt-2 w-full rounded-field bg-surface-container-high px-4 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-2 focus:outline-offset-0 focus:outline-ring"
            />
          </div>

          <div className="w-64 overflow-hidden rounded-card bg-surface-container-lowest shadow-e1 transition-shadow hover:shadow-e2">
            <div className="flex h-40 items-center justify-center bg-primary-fixed text-on-primary-fixed">
              <span className="text-label-bold">food photography</span>
            </div>
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="font-display text-headline-md text-on-surface">Smash Burger</p>
                <p className="mt-1 text-headline-md font-display text-primary">$12.50</p>
              </div>
              <button
                type="button"
                aria-label="Add Smash Burger to cart"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-container text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span aria-hidden="true" className="text-headline-md leading-none">
                  +
                </span>
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
