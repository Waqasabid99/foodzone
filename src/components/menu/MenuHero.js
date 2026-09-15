"use client";

import { useState } from "react";
import { Filter, Search, X } from "lucide-react";

/**
 * The menu's masthead: title, search, and the category pills.
 *
 * Filtering happens in the browser over the menu already on the page rather
 * than by round-tripping to the server. A restaurant menu is a hundred items at
 * the outside — it is all here already, and a request per keystroke would be
 * slower and worse. Search over a catalog of thousands would be the other way
 * round, which is what `/api/v1/search` exists for.
 */
export default function MenuHero({
  storeName,
  sections,
  query,
  onQueryChange,
  activeSection,
  onSectionChange,
  dietaryOptions,
  activeDietary,
  onDietaryChange,
}) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <section className="rounded-banner bg-gradient-to-br from-surface-container-low via-surface-container to-primary-container/20 px-6 py-10 md:px-10 md:py-14">
      <p className="text-label-bold uppercase tracking-widest text-primary">
        Sear the senses • Smash the rules
      </p>

      <h1 className="mt-3 font-display text-headline-lg-mobile uppercase leading-none text-on-surface md:text-headline-lg">
        The <span className="text-primary-container">bold</span> menu
      </h1>

      <p className="mt-3 max-w-xl text-body-md text-on-surface-variant">
        Flame-seared, smashed to perfection, and stacked high. Choose your flavor journey at{" "}
        {storeName}.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <label htmlFor="menu-search" className="sr-only">
            Search the menu
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            id="menu-search"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search burgers, dirty fries, craft shakes…"
            className="w-full rounded-full bg-surface-container-lowest py-3 pl-11 pr-10 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
          aria-controls="menu-preferences"
          disabled={dietaryOptions.length === 0}
          className="flex items-center gap-2 rounded-full bg-inverse-surface px-5 py-3 font-display text-label-bold text-inverse-on-surface transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Filter aria-hidden="true" className="size-4" />
          Preferences
          {activeDietary.length ? (
            <span className="rounded-full bg-primary-container px-2 text-on-primary-container">
              {activeDietary.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Only the dietary tags the menu actually carries are offered. A filter
          for "Vegan" on a menu with no vegan item is a promise of an empty
          result. */}
      {showFilters && dietaryOptions.length ? (
        <fieldset id="menu-preferences" className="mt-4 rounded-card bg-surface-container-lowest p-4">
          <legend className="px-1 text-label-bold uppercase text-on-surface-variant">
            Dietary preferences
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {dietaryOptions.map((option) => {
              const checked = activeDietary.includes(option.code);
              return (
                <label
                  key={option.code}
                  className={`cursor-pointer rounded-full px-4 py-2 text-label-bold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                    checked
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() =>
                      onDietaryChange(
                        checked
                          ? activeDietary.filter((code) => code !== option.code)
                          : [...activeDietary, option.code],
                      )
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Pill active={activeSection === null} onClick={() => onSectionChange(null)}>
          All
        </Pill>
        {sections.map((section) => (
          <Pill
            key={section.id}
            active={activeSection === section.id}
            onClick={() => onSectionChange(section.id)}
          >
            {section.name}
          </Pill>
        ))}
      </div>
    </section>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-label-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        active
          ? "bg-primary-container text-on-primary-container"
          : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"
      }`}
    >
      {children}
    </button>
  );
}
