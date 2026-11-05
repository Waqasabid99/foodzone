import Link from "next/link";
import { ExternalLink, Flame } from "lucide-react";

/**
 * The site footer.
 *
 * Three of its five columns are built from live data rather than written here:
 * Menu lists real categories, Locations lists real outlets, and Connect shows
 * only the social profiles somebody has actually configured. A footer is where
 * hardcoded links rot quietly — nobody notices a category that was renamed
 * eight months ago sitting in the bottom corner of every page.
 *
 * The columns that cannot be derived are static, and every one of those routes
 * still has to be built. They are listed rather than dropped because they are
 * the planned information architecture, not decoration.
 */

/**
 * The pages behind these are rows in `ContentPage`, edited from the dashboard.
 *
 * Only routes that resolve. This list used to carry `/nutrition`, `/careers`
 * and three `/story/*` pages that were never built — five links on the bottom
 * of every page in the shop, each one a 404. A link to nothing is worse than a
 * missing link: somebody follows it, and what they learn is that the site is
 * broken. They come back when there is a page to point them at.
 */
const SUPPORT_LINKS = [
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
  { href: "/careers", label: "Careers" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/terms-of-use", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Policy" },
];

/**
 * Named links rather than logos.
 *
 * lucide dropped its brand icons in v1 over trademark, and hand-drawing
 * lookalikes of Instagram, Facebook, YouTube and TikTok misrepresents four
 * companies whose marks all come with usage rules attached. The name is also
 * the more accessible control: an icon-only link needs an `aria-label` to say
 * the same thing, and half the time it does not get one.
 */
const SOCIALS = [
  { key: "store.social_instagram", label: "Instagram" },
  { key: "store.social_facebook", label: "Facebook" },
  { key: "store.social_youtube", label: "YouTube" },
  { key: "store.social_tiktok", label: "TikTok" },
];

export default function Footer({ storeName = "FoodZone", tagline = "", categories = [], branches = [], socials = {} }) {
  const socialLinks = SOCIALS.map((social) => ({ ...social, href: socials[social.key] })).filter(
    (social) => Boolean(social.href),
  );

  return (
    // The top rule is the brand's own orange, which is what separates the
    // footer from the page above it in the design.
    <footer className="mt-20 border-t-4 border-primary-container bg-inverse-surface text-inverse-on-surface">
      <div className="mx-auto max-w-page px-margin-mobile py-14 md:px-margin-desktop">
        <div className="flex flex-col gap-10">
          <div className="max-w-md">
            <p className="flex items-center gap-3">
              <Flame aria-hidden="true" className="size-7 text-primary-container" />
              <span className="font-display text-headline-lg-mobile uppercase tracking-tight text-primary-fixed">
                {storeName}
              </span>
            </p>

            {tagline ? (
              <p className="mt-4 text-body-md text-inverse-on-surface/75">{tagline}</p>
            ) : null}
          </div>

        </div>

        <hr className="my-10 border-inverse-on-surface/15" />

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {categories.length ? (
            <FooterColumn title="Menu">
              {categories.slice(0, 5).map((category) => (
                <FooterLink key={category.id} href={`/menu?category=${category.slug}`}>
                  {category.name}
                </FooterLink>
              ))}
            </FooterColumn>
          ) : null}

          <FooterColumn title="Links">
            {SUPPORT_LINKS.map((link) => (
              <FooterLink key={link.href} href={link.href}>
                {link.label}
              </FooterLink>
            ))}
          </FooterColumn>

          {branches.length ? (
            <FooterColumn title="Locations">
              {branches.slice(0, 5).map((branch) => (
                <li key={branch.id} className="text-body-md text-inverse-on-surface/70">
                  {branch.name}
                  {branch.city ? (
                    <span className="block text-label-bold font-normal text-inverse-on-surface/45">
                      {branch.city}
                    </span>
                  ) : null}
                </li>
              ))}
            </FooterColumn>
          ) : null}

          {socialLinks.length ? (
            <FooterColumn title="Connect">
              {socialLinks.map(({ label, href }) => (
                <li key={label}>
                  <a
                    href={href}
                    // These leave the site, so they carry the usual protections
                    // against the opened tab reaching back into this one.
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-body-md text-inverse-on-surface/70 transition-colors hover:text-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
                  >
                    {label}
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </FooterColumn>
          ) : null}
        </div>

        <hr className="my-10 border-inverse-on-surface/15" />

        <div className="flex flex-wrap items-center justify-between gap-3 text-label-bold font-normal text-inverse-on-surface/55">
          <p>
            &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
          </p>
          <p>Sizzle responsibly.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }) {
  return (
    <nav aria-label={title}>
      <p className="font-display text-label-bold uppercase tracking-wide text-inverse-on-surface">{title}</p>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </nav>
  );
}

function FooterLink({ href, children }) {
  return (
    <li>
      <Link
        href={href}
        className="text-body-md text-inverse-on-surface/70 transition-colors hover:text-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
      >
        {children}
      </Link>
    </li>
  );
}
