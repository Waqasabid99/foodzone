"use client";

import { useMemo, useState } from "react";
import { AlertCircle, MapPin } from "lucide-react";
import MenuHero from "@/components/menu/MenuHero";
import MenuItemCard from "@/components/menu/MenuItemCard";
import OrderSummaryBar from "@/components/menu/OrderSummaryBar";
import OrderTypeSwitch from "@/components/menu/OrderTypeSwitch";

/**
 * Why a chosen outlet is not showing its own menu.
 *
 * Both of these are ordinary operational states rather than errors — a branch
 * that has not been set up yet, and one whose breakfast menu ended before lunch
 * begins — so they are explained rather than hidden, and the prices on screen
 * are described as indicative because that is what they are.
 */
const REASON_NOTES = {
  NO_MENU_CONFIGURED:
    "This outlet hasn't published a menu yet. Prices below are our standard ones and are confirmed when you order.",
  NO_MENU_SCHEDULED_NOW:
    "Nothing is scheduled to be served at this outlet right now. Prices below are our standard ones and are confirmed when you order.",
};

const DIETARY_LABELS = {
  VEG: "Vegetarian",
  VEGAN: "Vegan",
  HALAL: "Halal",
  GLUTEN_FREE: "Gluten free",
};

/**
 * The interactive half of the menu page.
 *
 * The data arrives already rendered by the server; this owns only what the
 * visitor does to it — search, dietary filters, jumping to a section. Keeping
 * that split means the menu is in the HTML for a crawler and for someone on a
 * slow connection, and the filtering costs no round trip.
 */
export default function MenuBrowser({ data, canChooseBranch = false, orderingAvailable = true, initialQuery = "" }) {
  // A scanned category code opens the menu already narrowed to that category.
  // The search already matches category names, so this reuses the filter the
  // customer can see and clear rather than hiding a mode they cannot.
  const [query, setQuery] = useState(initialQuery);
  const [activeSection, setActiveSection] = useState(null);
  const [dietary, setDietary] = useState([]);

  const branchId = data.branch?.id ?? null;

  // Only the tags present on this menu, so no filter can promise an empty result.
  const dietaryOptions = useMemo(() => {
    const present = new Set();
    for (const section of data.sections) {
      for (const item of section.items) {
        for (const code of item.dietary ?? []) present.add(code);
      }
    }
    return [...present].map((code) => ({ code, label: DIETARY_LABELS[code] ?? code }));
  }, [data.sections]);

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return data.sections
      .filter((section) => activeSection === null || section.id === activeSection)
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (dietary.length && !dietary.every((code) => item.dietary?.includes(code))) return false;
          if (!needle) return true;
          return (
            item.name.toLowerCase().includes(needle) ||
            (item.shortDescription ?? "").toLowerCase().includes(needle) ||
            (item.categoryName ?? "").toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [data.sections, query, activeSection, dietary]);

  const matchCount = sections.reduce((total, section) => total + section.items.length, 0);
  const filtering = Boolean(query.trim()) || dietary.length > 0 || activeSection !== null;

  return (
    <>
      <MenuHero
        storeName={data.storeName}
        sections={data.sections}
        query={query}
        onQueryChange={setQuery}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        dietaryOptions={dietaryOptions}
        activeDietary={dietary}
        onDietaryChange={setDietary}
      />

      {/* Which menu this is, stated plainly — and keyed on the source rather
          than on whether a branch is selected. Those come apart exactly when it
          matters: an outlet whose menu could not be served falls back to the
          catalog, and claiming that is "the live menu for Seaside" would be the
          worst thing this page could say. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-body-md text-on-surface-variant">
          {data.source === "branch" ? (
            <>
              <MapPin aria-hidden="true" className="size-4 text-primary" />
              Showing the live menu for <strong className="text-on-surface">{data.branch.name}</strong>
              {data.menuName ? <span>· {data.menuName}</span> : null}
            </>
          ) : (
            <>
              <AlertCircle aria-hidden="true" className="size-4 text-warning" />
              {data.branch ? (
                <>
                  <strong className="text-on-surface">{data.branch.name}</strong> has no menu running
                  right now — showing our full catalog instead.
                </>
              ) : (
                <>Showing our full catalog. Prices and availability depend on the outlet you choose.</>
              )}
            </>
          )}
        </p>
        {/* Only with an outlet: without one there is no menu for the order
            type to choose between. */}
        <OrderTypeSwitch renderedType={data.orderType} showSwitch={Boolean(data.branch)} />
      </div>

      {REASON_NOTES[data.reason] ? (
        <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
          {REASON_NOTES[data.reason]}
        </p>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {filtering ? `${matchCount} items match your filters.` : ""}
      </p>

      {sections.length === 0 ? (
        <p
          className={`rounded-card px-6 py-12 text-center text-body-md ${
            data.failed
              ? "bg-error-container text-on-error-container"
              : "bg-surface-container-low text-on-surface-variant"
          }`}
        >
          {/* A read that failed is not an empty menu. Telling someone the
              kitchen has nothing on when the database timed out sends them to
              a competitor over a blip. */}
          {data.failed
            ? "We couldn't load the menu just now. Please refresh in a moment."
            : data.itemCount === 0
              ? "Nothing is on the menu here yet. Check back shortly."
              : "No items match what you're looking for. Try clearing a filter."}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.id} aria-labelledby={`section-${section.id}`}>
            <h2
              id={`section-${section.id}`}
              className="font-display text-headline-md uppercase text-on-surface"
            >
              {section.name}
            </h2>
            {section.description ? (
              <p className="mt-1 text-body-md text-on-surface-variant">{section.description}</p>
            ) : null}

            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {section.items.map((item) => (
                <MenuItemCard
                  key={`${section.id}-${item.id}`}
                  item={item}
                  currency={data.currency}
                  branchId={branchId}
                  canChooseBranch={canChooseBranch}
                  orderingAvailable={orderingAvailable}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <OrderSummaryBar currency={data.currency} prepMinutes={data.prepMinutes} />
    </>
  );
}
