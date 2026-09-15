"use client";

import Link from "next/link";
import * as icons from "lucide-react";
import { Circle } from "lucide-react";
import { activeHref } from "@/lib/dashboard-nav";

/**
 * The navigation itself.
 *
 * Presentational on purpose: it is handed the tree it should draw and the path
 * it is on, and owns neither. The same component serves the staff dashboard and
 * a customer's account area, and is rendered twice at once — once in the
 * desktop rail, once inside the mobile drawer — so any state it kept would have
 * to be kept in sync between two copies of itself.
 *
 * The tree arriving here is already filtered to what this person may see. That
 * filtering is a courtesy, not a control: every page and every endpoint behind
 * these links checks the same permission again.
 */
export default function Sidebar({ nav, pathname, collapsed = false, onNavigate = null }) {
  const active = activeHref(nav, pathname);

  return (
    <nav aria-label="Sections" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
      {nav.length === 0 ? (
        <p className="px-3 py-2 text-body-md text-on-surface-variant">
          You don&apos;t have access to anything here yet.
        </p>
      ) : null}

      <ul className="flex flex-col gap-6">
        {nav.map((section) => (
          <li key={section.id}>
            {/* The heading is hidden from sight when collapsed but kept for a
                screen reader, which has no icons to group links by. */}
            <h2
              className={`px-3 text-label-bold uppercase tracking-widest text-on-surface-variant ${
                collapsed ? "sr-only" : ""
              }`}
            >
              {section.label}
            </h2>

            <ul className={collapsed ? "flex flex-col gap-1" : "mt-2 flex flex-col gap-1"}>
              {section.items.map((item) => {
                const Icon = icons[item.icon] ?? Circle;
                const isActive = item.href === active;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      // `aria-current` is what tells a screen reader which page
                      // it is on; colour alone says nothing.
                      aria-current={isActive ? "page" : undefined}
                      // Collapsed, the label is the only thing naming the link,
                      // so it moves into the accessible name and the tooltip.
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
          </li>
        ))}
      </ul>
    </nav>
  );
}
