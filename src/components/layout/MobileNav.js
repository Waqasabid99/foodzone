"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";
import * as icons from "lucide-react";
import { LogOut, Menu, Package, X } from "lucide-react";
import { loginHref, registerHref } from "@/lib/redirects";
import { useSession, logoutSession } from "@/hooks/useSession";
import { workspaceLinks } from "@/lib/dashboard-nav";
import LocationPicker from "@/components/locations/LocationPicker";
import SiteSearch from "@/components/layout/SiteSearch";

/**
 * The small-screen navigation.
 *
 * Split out as the only client component in the header, so opening a menu does
 * not cost the whole header its server rendering.
 *
 * It also owns the account controls below `md`, where `AuthNav` is hidden.
 * Putting "Log in" and "Sign up" in the header at that width would leave a
 * phone showing a logo, a theme toggle, two auth buttons, a cart and a
 * hamburger across about 380 pixels.
 */
export default function MobileNav({ links, branches = [], currency = "PKR" }) {
  const [open, setOpen] = useState(false);
  const { status, user } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const close = () => setOpen(false);

  async function handleLogout() {
    await logoutSession();
    close();
    toast.success("Signed out.");
    router.push("/");
    router.refresh();
  }

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="grid size-10 place-items-center rounded-full text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open ? (
        <nav
          id="mobile-nav"
          className="absolute inset-x-0 top-full border-t border-outline-variant bg-surface px-margin-mobile py-4 shadow-e3"
        >
          {/* First, above the links: on a phone the menu is long and scrolling
              it is the slow way to a dish somebody can already name. Closing
              the drawer on navigate is the search's job, hence `onNavigate`. */}
          <div className="mb-3">
            <SiteSearch currency={currency} onNavigate={close} />
          </div>

          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={close} className={ITEM_CLASS}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* Renders nothing for a single-outlet restaurant, so the divider
              above it would otherwise be a line under nothing. */}
          {branches.length > 1 ? (
            <div className="mt-3 border-t border-outline-variant pt-3">
              <LocationPicker branches={branches} />
            </div>
          ) : null}

          {/* The session is resolved in the browser, so on first open it may
              not be known yet. Rendering nothing beats rendering the wrong
              half of it — this section appears a moment later rather than
              flipping from "Log in" to a name. */}
          {status === "loading" ? null : (
            <div className="mt-3 flex flex-col gap-1 border-t border-outline-variant pt-3">
              {status === "authenticated" && user ? (
                <>
                  <p className="px-3 py-2">
                    <span className="block truncate text-body-md text-on-surface">{user.name}</span>
                    <span className="block truncate text-label-bold font-normal text-on-surface-variant">
                      {user.email}
                    </span>
                  </p>

                  {user.emailVerified ? null : (
                    <Link
                      href="/verify-email"
                      onClick={close}
                      className="rounded-field bg-warning-container px-3 py-2.5 text-label-bold text-on-warning-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Verify your email to order
                    </Link>
                  )}

                  {/* The same links the desktop menu offers, from the same
                      helper — two menus that answered "where do I work?"
                      differently would be a bug nobody notices for months. */}
                  {workspaceLinks(user.permissions).map((link) => {
                    const Icon = icons[link.icon] ?? Package;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={close}
                        className={`flex items-center gap-2 ${ITEM_CLASS}`}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        {link.label}
                      </Link>
                    );
                  })}

                  <button
                    type="button"
                    onClick={handleLogout}
                    className={`flex w-full items-center gap-2 text-left ${ITEM_CLASS}`}
                  >
                    <LogOut aria-hidden="true" className="size-4" />
                    Log out
                  </button>
                </>
              ) : (
                <>
                  <Link href={loginHref(pathname ?? "/")} onClick={close} className={ITEM_CLASS}>
                    Log in
                  </Link>
                  <Link
                    href={registerHref(pathname ?? "/")}
                    onClick={close}
                    className="rounded-field bg-primary-container px-3 py-2.5 text-center font-display text-label-bold text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          )}
        </nav>
      ) : null}
    </div>
  );
}

const ITEM_CLASS =
  "block rounded-field px-3 py-2.5 text-body-md text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
