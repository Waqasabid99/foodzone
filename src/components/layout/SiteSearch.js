"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

/**
 * Search, answered as you type.
 *
 * **Debounced at 250ms and every stale reply is dropped.** Typing "burger"
 * fires seven requests if you let it, they come back out of order, and the
 * answer for "bur" lands last and overwrites the right one. The sequence
 * counter below is what stops that — a reply is rendered only if nothing newer
 * has been asked for since. Without it the bug is rare, intermittent, and
 * impossible to reproduce on a fast connection.
 *
 * **Two characters minimum**, matching the API: one character matches most of
 * the menu, which is a slow query that tells the reader nothing.
 *
 * The combobox is a real one — `aria-expanded`, `aria-controls`, arrow keys,
 * Enter and Escape — because a search box that only works with a mouse is the
 * kind of thing that passes review and fails the person using a keyboard.
 */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export default function SiteSearch({ currency = "PKR", onNavigate = null }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  // Monotonic: only the newest request is allowed to set state.
  const sequence = useRef(0);

  /**
   * Typing: the only place the query changes, and the only place the spinner
   * and the stale results are cleared.
   *
   * Deliberately here rather than in the effect below. React now refuses a
   * synchronous `setState` in an effect body — it is a second render pass
   * every keystroke — and the honest reading is that none of this is a
   * side effect of the query changing: it *is* the typing. The effect is left
   * doing one thing, which is waiting 250ms and then fetching.
   */
  /** Empties the box without touching whether the panel is open. */
  function clear() {
    // Invalidate anything in flight, or a reply for "bu" lands after the box
    // has been emptied and reopens a panel nobody asked for.
    sequence.current += 1;
    setQuery("");
    setResults(null);
    setLoading(false);
  }

  function onType(value) {
    setQuery(value);
    setOpen(true);

    if (value.trim().length < MIN_QUERY) {
      sequence.current += 1;
      setResults(null);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) return undefined;

    const mine = ++sequence.current;
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/search?q=${encodeURIComponent(text)}&limit=6`);
        if (mine !== sequence.current) return;
        setResults(data);
        setActive(-1);
      } catch {
        if (mine !== sequence.current) return;
        // A failed search is an empty one. There is nothing useful to say to
        // somebody mid-keystroke, and an error banner under a search box is
        // read as "the site is broken" rather than "that request failed".
        setResults({ products: [], categories: [] });
      } finally {
        if (mine === sequence.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on a click anywhere else. Pointerdown rather than click, so the
  // panel is gone before a tap outside it lands on whatever is underneath.
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const products = results?.products ?? [];
  const categories = results?.categories ?? [];
  const rows = [
    ...products.map((product) => ({ key: `p-${product.id}`, href: `/menu/${product.slug}`, product })),
    ...categories.map((category) => ({ key: `c-${category.id}`, href: `/menu?category=${category.slug}`, category })),
  ];
  const showing = open && query.trim().length >= MIN_QUERY;

  function go(href) {
    setOpen(false);
    clear();
    onNavigate?.();
    router.push(href);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!showing || !rows.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? rows.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      // Nothing highlighted means "show me everything for this", which is the
      // menu filtered — not the first guess, which may not be what they meant.
      event.preventDefault();
      go(active >= 0 ? rows[active].href : `/menu?q=${encodeURIComponent(query.trim())}`);
    }
  }

  const cheapest = (product) =>
    product.variants?.reduce((min, variant) => (min === null || variant.price < min ? variant.price : min), null) ??
    null;

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant"
        />

        <input
          ref={inputRef}
          /* `text`, not `search`: WebKit and Chrome draw their own clear
             affordance inside a `type="search"` box, which sat next to the one
             below and gave the field two X buttons doing the same job. The
             combobox role carries the semantics either way. */
          type="text"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search the menu"
          placeholder="Search"
          value={query}
          onChange={(event) => onType(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-h-10 w-full rounded-full border border-outline-variant bg-surface-container-low pl-9 pr-9 text-body-md text-on-surface placeholder:text-on-surface-variant focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />

        {loading ? (
          <Loader2 aria-hidden="true" className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-on-surface-variant" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              clear();
              inputRef.current?.focus();
            }}
            aria-label="Clear the search"
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      {showing ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          /* Wider than the box it hangs from, and right-aligned so it cannot
             run off the edge. Tied to the input's width, a 176px panel
             truncated every dish name to "Zinger Burg…", which is not a
             result anybody can read. */
          className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-outline-variant bg-surface-container-lowest shadow-e3"
        >
          {rows.length ? (
            <>
              <ul className="flex flex-col py-1">
                {rows.map((row, index) => (
                  <li key={row.key}>
                    <Link
                      href={row.href}
                      role="option"
                      aria-selected={index === active}
                      onPointerEnter={() => setActive(index)}
                      onClick={() => go(row.href)}
                      className={`flex items-center gap-3 px-4 py-2.5 text-left ${index === active ? "bg-surface-container-high" : ""}`}
                    >
                      {row.product ? (
                        <>
                          {row.product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.product.imageUrl}
                              alt=""
                              loading="lazy"
                              className="size-10 shrink-0 rounded-field object-cover"
                            />
                          ) : (
                            <span aria-hidden="true" className="size-10 shrink-0 rounded-field bg-surface-container-high" />
                          )}

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label-bold text-on-surface">{row.product.name}</span>
                            <span className="block truncate text-body-md text-on-surface-variant">
                              {row.product.category?.name ?? "Menu"}
                            </span>
                          </span>

                          {cheapest(row.product) != null ? (
                            <span className="shrink-0 tabular-nums text-body-md text-on-surface">
                              {formatMoney(cheapest(row.product), currency)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span
                            aria-hidden="true"
                            className="grid size-10 shrink-0 place-items-center rounded-field bg-surface-container-high"
                          >
                            <Search className="size-4 text-on-surface-variant" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label-bold text-on-surface">{row.category.name}</span>
                            <span className="block text-body-md text-on-surface-variant">Category</span>
                          </span>
                        </>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => go(`/menu?q=${encodeURIComponent(query.trim())}`)}
                className="block w-full border-t border-outline-variant px-4 py-3 text-left text-body-md text-primary hover:bg-surface-container focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                See everything for &ldquo;{query.trim()}&rdquo;
              </button>
            </>
          ) : (
            <p className="px-4 py-6 text-center text-body-md text-on-surface-variant">
              {loading ? "Looking…" : `Nothing on the menu matches “${query.trim()}”.`}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
