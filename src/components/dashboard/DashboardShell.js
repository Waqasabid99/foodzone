"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Flame, LogOut, Menu, X } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import ThemeToggle from "@/components/theme/ThemeToggle";
import NotificationBell from "@/components/layout/NotificationBell";
import { useSidebarCollapsed, toggleSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { logoutSession } from "@/hooks/useSession";
import { initials } from "@/lib/format";

/**
 * The workspace chrome: sidebar, top bar, and the page itself.
 *
 * One component for the staff dashboard and a customer's account area, because
 * the difference between them is which tree they are handed — not how a drawer
 * behaves at 400px.
 *
 * Two layouts rather than one that stretches. Below `lg` the sidebar is an
 * overlay drawer: a phone has no room to give up a third of the screen
 * permanently, and a rail that shrank to fit would be a row of unlabelled icons
 * nobody can read. From `lg` up it is a real column that can be collapsed to
 * icons for people working on a laptop. The nav is rendered once for each, and
 * both are in the DOM at all times so the browser, not React, decides which is
 * showing — no resize listener, nothing to get out of step.
 */
export default function DashboardShell({ nav, user, storeName = "FoodZone", homeHref = "/", children }) {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useSidebarCollapsed();
  const drawerRef = useRef(null);
  const triggerRef = useRef(null);

  /**
   * The drawer, remembered against the page it was opened on.
   *
   * Navigating has to close it, and deriving that during render is the only
   * way that also covers the back button — an effect watching `pathname` would
   * be a `setState` in an effect, which React now flags outright, and an
   * `onClick` on each link would miss every navigation it did not cause.
   */
  const [drawer, setDrawer] = useState({ open: false, path: pathname });
  const drawerOpen = drawer.open && drawer.path === pathname;

  const openDrawer = () => setDrawer({ open: true, path: pathname });
  const closeDrawer = () => setDrawer({ open: false, path: pathname });

  useEffect(() => {
    if (!drawerOpen) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      setDrawer({ open: false, path: pathname });
      triggerRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    drawerRef.current?.focus();

    // Restored to whatever it was rather than hardcoded back to "", so this
    // cannot clobber another component also holding the scroll.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen, pathname]);

  async function signOut() {
    await logoutSession();
    router.push("/login");
  }

  const brand = (
    <Link
      href={homeHref}
      className="flex items-center gap-2 rounded-field px-2 py-1 font-display text-label-bold uppercase tracking-wide text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Flame aria-hidden="true" className="size-6 shrink-0 text-primary" />
      <span className={collapsed ? "sr-only lg:sr-only" : ""}>{storeName}</span>
    </Link>
  );

  /*
   * `min-h-dvh`, not `min-h-full`: a percentage min-height resolves to nothing
   * when the parent's height is auto, as <body> here is, so the shell was only
   * ever as tall as its content and the sidebar's border stopped partway down
   * any short page — which the account area, with its small pages, showed up.
   *
   * The rail is `sticky` at exactly `h-dvh`, which is what stops it setting the
   * height of the document. Seventy links are taller than any screen, and as an
   * ordinary stretched flex item the rail made the *page* that tall: the nav's
   * own `overflow-y-auto` never engaged, because `flex-1` had been handed all
   * the height it asked for. The result was a scrollbar belonging to the
   * sidebar scrolling the content pane as well, and a short page scrolling
   * through empty space beside a list of links.
   *
   * Pinned rather than making the content pane its own scroll container,
   * deliberately. The page keeps the document's scrollbar, so the sticky header
   * below goes on working untouched and printing stays exactly as it was — a
   * receipt inside an `overflow` container prints only the part that happens to
   * be on screen.
   *
   * `self-start` because a stretched flex item has no room left to move in, and
   * sticky then silently does nothing.
   */
  return (
    <div className="flex min-h-dvh">
      {/* --- desktop rail ------------------------------------------------- */}
      <aside
        data-print="hide"
        className={`hidden shrink-0 border-r border-outline-variant bg-surface-container-lowest lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start ${
          collapsed ? "lg:w-20" : "lg:w-72"
        }`}
      >
        <div className={`flex h-16 items-center border-b border-outline-variant px-3 ${collapsed ? "justify-center" : ""}`}>
          {brand}
        </div>

        <Sidebar nav={nav} pathname={pathname} collapsed={collapsed} />

        <div className="border-t border-outline-variant p-3">
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            className="flex w-full items-center justify-center gap-2 rounded-field px-3 py-2 text-label-bold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {collapsed ? (
              <ChevronRight aria-hidden="true" className="size-5" />
            ) : (
              <>
                <ChevronLeft aria-hidden="true" className="size-5" />
                Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      {/* --- mobile drawer ------------------------------------------------ */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-100 lg:hidden">
          {/* A real button, so tapping outside closes it and the control is
              reachable from the keyboard rather than being a dead div. */}
          <button
            type="button"
            aria-label="Close the menu"
            onClick={closeDrawer}
            className="absolute inset-0 size-full bg-black/50"
          />

          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="relative flex h-full w-[min(20rem,85vw)] flex-col bg-surface-container-lowest shadow-e3 focus:outline-none"
          >
            <div className="flex h-16 items-center justify-between border-b border-outline-variant px-3">
              {brand}
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close the menu"
                className="grid size-10 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <Sidebar nav={nav} pathname={pathname} onNavigate={closeDrawer} />

            <UserPanel user={user} onSignOut={signOut} />
          </div>
        </div>
      ) : null}

      {/* --- page --------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-print="hide"
          className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest/95 px-4 backdrop-blur md:px-6"
        >
          <button
            ref={triggerRef}
            type="button"
            onClick={openDrawer}
            aria-label="Open the menu"
            aria-expanded={drawerOpen}
            className="grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>

          <div className="min-w-0 flex-1" />

          {/* Staff have a workspace inbox rather than an account one — a low
              stock warning is not something to read on the storefront. */}
          <NotificationBell href="/dashboard/notifications" />

          <ThemeToggle />

          <div className="hidden items-center gap-3 lg:flex">
            <UserChip user={user} />
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="grid size-10 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <LogOut aria-hidden="true" className="size-5" />
            </button>
          </div>
        </header>

        {/* `min-w-0` all the way down, or one wide table makes the whole page
            scroll sideways instead of scrolling inside its own container. */}
        <main data-print="page" className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Your own name, and the way to your own account. */
function UserChip({ user, href = null }) {
  if (!user) return null;

  const Tag = href ? Link : "span";

  return (
    <Tag
      {...(href ? { href, className: "flex items-center gap-2 rounded-field p-1 hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" } : { className: "flex items-center gap-2" })}
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-full bg-primary-container font-display text-label-bold text-on-primary-container"
      >
        {initials(user.name)}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-label-bold text-on-surface">{user.name}</span>
        {user.roleLabel ? (
          <span className="text-label-bold font-normal text-on-surface-variant">{user.roleLabel}</span>
        ) : null}
      </span>
    </Tag>
  );
}

function UserPanel({ user, onSignOut }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-outline-variant p-3">
      <UserChip user={user} href="/dashboard/account" />
      <button
        type="button"
        onClick={onSignOut}
        aria-label="Sign out"
        className="grid size-10 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <LogOut aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}
