"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";
import * as icons from "lucide-react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { initials } from "@/lib/format";
import { loginHref, registerHref } from "@/lib/redirects";
import { useSession, logoutSession } from "@/hooks/useSession";
import { workspaceLinks } from "@/lib/dashboard-nav";

/**
 * The account corner of the header: log in / sign up, or who you are.
 *
 * Three states, and the third is the one worth designing for. The session is
 * resolved in the browser (see `useSession` for why), so for a moment after
 * first paint nobody is identified. Rendering "Log in" during that moment would
 * show a signed-in customer a button telling them they are not — and then swap
 * it under their cursor. Instead the space is held at roughly the width the
 * real controls take, so nothing jumps when the answer arrives.
 */
export default function AuthNav() {
  const { status, user } = useSession();
  const pathname = usePathname();

  // `usePathname` and not `useSearchParams`: the latter forces every page that
  // renders this header to be client-rendered up to the nearest Suspense
  // boundary, which for a header in the root layout is the whole page. Losing
  // the query string on the return trip is a much smaller cost.
  const next = pathname ?? "/";

  if (status === "loading") {
    return <div aria-hidden="true" className="h-10 w-32 animate-pulse rounded-full bg-surface-container-high" />;
  }

  if (status === "authenticated" && user) return <AccountMenu user={user} />;

  // "unknown" — the session request failed — falls through to the signed-out
  // controls. They work for everyone: a signed-in visitor who lands here is
  // shown a login page that immediately redirects them back out again.
  return (
    <div className="flex items-center gap-1">
      <Link
        href={loginHref(next)}
        className="rounded-full px-3 py-2 text-body-md text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Log in
      </Link>

      <Link
        href={registerHref(next)}
        className="hidden rounded-full border border-outline px-4 py-2 font-display text-label-bold text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-block"
      >
        Sign up
      </Link>
    </div>
  );
}

/**
 * The signed-in menu.
 *
 * A menu rather than a bare "Log out" button in the header: logging out is a
 * destructive-feeling action and does not belong one stray click from the cart
 * icon.
 */
function AccountMenu({ user }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Focus goes back where it came from, or it lands on the page body and
      // a keyboard user has to tab in from the top again.
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);

    await logoutSession();
    setOpen(false);
    toast.success("Signed out.");
    router.push("/");
    router.refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="account-menu"
        className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-2 text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-container font-display text-label-bold text-on-primary-container"
        >
          {initials(user.name) || <UserRound className="size-4" />}
        </span>
        <span className="hidden max-w-24 truncate text-body-md sm:inline">{user.name}</span>
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        <span className="sr-only">Account menu</span>
      </button>

      {open ? (
        <div
          id="account-menu"
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-e3"
        >
          <p className="border-b border-outline-variant px-4 py-3">
            <span className="block truncate text-body-md text-on-surface">{user.name}</span>
            <span className="block truncate text-label-bold font-normal text-on-surface-variant">
              {user.email}
            </span>
          </p>

          {user.emailVerified ? null : (
            <Link
              href="/verify-email"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block bg-warning-container px-4 py-2.5 text-label-bold text-on-warning-container hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              Verify your email to order
            </Link>
          )}

          {/* Where this person's work lives, decided by what they may open
              rather than by which role they hold — a custom role gets the same
              answer as a seeded one, and a driver is sent to deliveries rather
              than to an overview they have no permission to read. */}
          {workspaceLinks(user.permissions).map((link) => {
            const Icon = icons[link.icon] ?? UserRound;
            return (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-body-md text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                <Icon aria-hidden="true" className="size-4" />
                {link.label}
              </Link>
            );
          })}

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-2 border-t border-outline-variant px-4 py-2.5 text-left text-body-md text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:opacity-60"
          >
            <LogOut aria-hidden="true" className="size-4" />
            {loggingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
