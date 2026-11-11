"use client";

import Link from "next/link";
import * as icons from "lucide-react";
import { ChevronDown, Circle } from "lucide-react";
import { activeHref } from "@/lib/dashboard-nav";
import { useSidebarSections, setSidebarSection } from "@/hooks/useSidebarSections";

/**
 * The navigation itself.
 *
 * Handed the tree it should draw and the path it is on, and owns neither. The
 * same component serves the staff dashboard and a customer's account area, and
 * is rendered twice at once — once in the desktop rail, once inside the mobile
 * drawer — which is why what little state it has lives in a module-level store
 * rather than in the component: two copies of itself cannot be kept in step.
 *
 * The tree arriving here is already filtered to what this person may see. That
 * filtering is a courtesy, not a control: every page and every endpoint behind
 * these links checks the same permission again.
 *
 * ## Folding
 *
 * Twelve sections and seventy links, of which nobody uses more than two or
 * three in a day. Each section folds away under its own heading and the choice
 * is remembered per device.
 *
 * Two rules keep it from hiding things:
 *
 *   * **The section holding the current page is open** until the person
 *     touches the sidebar — otherwise following a link from the overview into
 *     a folded section leaves no current page showing anywhere, which reads as
 *     broken. `useSidebarSections` explains how that is derived rather than
 *     effected.
 *   * **Collapsed to icons, nothing folds.** The headings are not on screen to
 *     click, so a folded section would be a gap in a column of icons with no
 *     way to open it.
 */
export default function Sidebar({ nav, pathname, collapsed = false, onNavigate = null }) {
  const active = activeHref(nav, pathname);
  const { overrides, path } = useSidebarSections();

  /*
   * Which section the current page belongs to. Resolved from the item that
   * `activeHref` picked, so it agrees with the link that is highlighted rather
   * than guessing from the path a second time.
   */
  const activeSectionId = active
    ? (nav.find((section) => section.items.some((item) => item.href === active))?.id ?? null)
    : null;

  // The sidebar has not been touched since this page was opened, so the
  // section holding it is shown whatever was stored.
  const justArrived = path !== pathname;

  const isOpen = (sectionId) => {
    if (collapsed) return true;
    if (justArrived && sectionId === activeSectionId) return true;
    return overrides[sectionId] ?? true;
  };

  return (
    // `min-h-0` with `flex-1`: a flex child's minimum size is its content by
    // default, so without it a long nav refuses to shrink and scrolls its
    // parent instead of itself. The drawer happens not to need it — its panel
    // has a definite height — but the rail does, and one rule for both beats
    // two that differ for reasons nobody will remember.
    <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
      {nav.length === 0 ? (
        <p className="px-3 py-2 text-body-md text-on-surface-variant">
          You don&apos;t have access to anything here yet.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {nav.map((section) => {
          const open = isOpen(section.id);
          const listId = `sidebar-section-${section.id}`;
          const holdsActive = section.id === activeSectionId;

          return (
            <li key={section.id}>
              {/*
                The heading stays an `h2` so the document outline is unchanged,
                with the button inside it rather than instead of it — a bare
                button is not a heading to anything navigating by them.

                Hidden from sight when the rail is collapsed but kept for a
                screen reader, which has no icons to group links by.
              */}
              <h2 className={collapsed ? "sr-only" : ""}>
                <button
                  type="button"
                  onClick={() => setSidebarSection(section.id, !open, pathname)}
                  aria-expanded={open}
                  // Only while the list is actually there: `aria-controls`
                  // pointing at an id that does not exist is worse than
                  // leaving it out, and `aria-expanded` is what a screen
                  // reader announces either way.
                  aria-controls={open ? listId : undefined}
                  className="flex w-full items-center gap-1.5 rounded-field px-3 py-1.5 text-label-bold uppercase tracking-widest text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
                  />
                  <span className="truncate">{section.label}</span>
                  {/*
                    A folded section holding the current page still says so, so
                    somebody who folds the section they are in does not lose
                    track of where that is.
                  */}
                  {!open && holdsActive ? (
                    <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
                  ) : null}
                </button>
              </h2>

              {/*
                Unmounted rather than hidden. Either would shorten the column —
                `display: none` takes no part in layout — but seventy links
                that are not on screen are seventy nodes to render, reconcile
                and hand to the accessibility tree for nothing.
              */}
              {open ? (
                <ul id={listId} className={collapsed ? "flex flex-col gap-1" : "mt-1 flex flex-col gap-1"}>
                  {section.items.map((item) => {
                    const Icon = icons[item.icon] ?? Circle;
                    const isActive = item.href === active;

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          // `aria-current` is what tells a screen reader which
                          // page it is on; colour alone says nothing.
                          aria-current={isActive ? "page" : undefined}
                          // Collapsed, the label is the only thing naming the
                          // link, so it moves into the accessible name and the
                          // tooltip.
                          aria-label={collapsed ? item.label : undefined}
                          title={collapsed ? item.label : undefined}
                          className={`flex items-center gap-3 rounded-field px-3 py-2.5 text-body-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                            collapsed ? "justify-center" : ""
                          } ${
                            isActive
                              ? "bg-primary-container font-semibold text-on-primary-container"
                              : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                          }`}
                        >
                          <Icon aria-hidden="true" className="size-5 shrink-0" />
                          {collapsed ? null : <span className="truncate">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
