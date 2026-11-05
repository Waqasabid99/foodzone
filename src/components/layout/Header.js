import Link from "next/link";
import Logo from "@/components/layout/Logo";
import MobileNav from "@/components/layout/MobileNav";
import AuthNav from "@/components/auth/AuthNav";
import LocationPicker from "@/components/locations/LocationPicker";
import SiteSearch from "@/components/layout/SiteSearch";
import CartButton from "@/components/layout/CartButton";
import HeaderNotifications from "@/components/layout/HeaderNotifications";

/**
 * Two lists, because the header and the drawer have different budgets.
 *
 * The header row is capped at 1280px however wide the window is, and it is
 * already carrying a logo, a search box, a branch picker, an account control,
 * a call to action and a cart. Five links did not fit — at a 1024px laptop the
 * row overflowed and put a horizontal scrollbar under every page.
 *
 * So the header carries the three that are about ordering food, and About and
 * Contact stay one tap away in the drawer and in the footer, where somebody
 * looking for a phone number goes anyway.
 */
const HEADER_LINKS = [
  { href: "/menu", label: "Menu" },
  { href: "/menu?offers=1", label: "Offers" },
  { href: "/videos", label: "Videos" },
];

const ALL_LINKS = [
  ...HEADER_LINKS,
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
];

export default function Header({ storeName = "FoodZone", branches = [], currency = "PKR" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-outline-variant bg-surface/90 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-page items-center justify-between gap-4 px-margin-mobile md:px-margin-desktop">
        <Logo name={storeName} />

        <nav aria-label="Main" className="hidden md:block">
          {/* Tighter once the search box is sharing the row, and never
              wrapping: a two-line header is worse than a cramped one. */}
          <ul className="flex items-center gap-8 lg:gap-4 xl:gap-5">
            {HEADER_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className="whitespace-nowrap text-body-md text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          * Sized to what is left, and allowed to give way.
          *
          * This row is capped at `max-w-page` (1280px) however wide the window
          * is, and a logo, five links, three controls and a cart already want
          * most of it. Two earlier attempts were both wrong in instructive
          * ways: `flex-1` with a zero basis got only the leftover space and
          * rendered an 85px box — a magnifier and nothing else — and a fixed
          * `w-44 shrink-0` could not give way, so the row overflowed by a few
          * pixels and put a horizontal scrollbar under every page on the site.
          *
          * A real width that is still allowed to shrink is the version that
          * holds: it is a usable box at every desktop width, and if anything
          * beside it ever grows — a longer store name, a translated link — the
          * search narrows rather than the document widening.
          *
          * The `xl` step spends the room the trimmed nav freed up. Measured
          * rather than guessed: a logo, three links, the controls and the gaps
          * come to 867px inside a 1232px row, so 320px of search leaves about
          * 45px spare. `w-96` would be 20px over and we would be back to a
          * scrollbar.
          */}
        <div className="hidden w-40 min-w-0 lg:block xl:w-80">
          <SiteSearch currency={currency} />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <LocationPicker branches={branches} />
          </div>

          {/* <ThemeToggle /> */}

          <div className="hidden md:block">
            <AuthNav />
          </div>

          <Link
            href="/menu"
            className="hidden whitespace-nowrap rounded-full bg-primary-container px-6 py-2.5 font-display text-label-bold text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-block"
          >
            Order Now
          </Link>

          <HeaderNotifications />

          <CartButton />

          <MobileNav links={ALL_LINKS} branches={branches} currency={currency} />
        </div>
      </div>
    </header>
  );
}
