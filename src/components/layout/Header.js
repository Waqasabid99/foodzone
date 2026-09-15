import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import Logo from "@/components/layout/Logo";
import MobileNav from "@/components/layout/MobileNav";
import AuthNav from "@/components/auth/AuthNav";
import LocationPicker from "@/components/locations/LocationPicker";

const NAV_LINKS = [
  { href: "/menu", label: "Menu" },
  { href: "/menu?offers=1", label: "Offers" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" }
];

export default function Header({ storeName = "FoodZone", branches = [] }) {
  return (
    <header className="sticky top-0 z-50 border-b border-outline-variant bg-surface/90 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-page items-center justify-between gap-4 px-margin-mobile md:px-margin-desktop">
        <Logo name={storeName} />

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className="text-body-md text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

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
            className="hidden rounded-full bg-primary-container px-6 py-2.5 font-display text-label-bold text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-block"
          >
            Order Now
          </Link>

          <Link
            href="/cart"
            aria-label="Cart"
            className="grid size-10 place-items-center rounded-full text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ShoppingCart aria-hidden="true" className="size-5" />
          </Link>

          <MobileNav links={NAV_LINKS} branches={branches} />
        </div>
      </div>
    </header>
  );
}
