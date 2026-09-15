"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Check, MapPin, X } from "lucide-react";
import { resolveBranch } from "@/lib/branch";
import { useSelectedBranchId, selectBranch } from "@/hooks/useSelectedBranch";
import { setCartBranch } from "@/hooks/useCart";
import { clearLocationPickerRequest, useLocationPickerRequested } from "@/hooks/useLocationPicker";

/**
 * "Locations" in the header: pick which outlet you are ordering from.
 *
 * Renders nothing at all when there is one outlet or none. A single-location
 * restaurant has no choice to make, and offering one implies a decision that
 * does not exist — the branch is simply resolved to the only one there is.
 * That check is why this component is handed the whole list rather than a
 * count: the parent cannot decide to hide it without knowing the same thing.
 *
 * The selection lives in a cookie so the server can read it before rendering
 * the menu, and it is pushed to the cart in the same action — branch is what
 * prices a basket, so a cart left pointing at the previous outlet would quote
 * one branch's prices for another's kitchen.
 */
export default function LocationPicker({ branches = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  // The header is rendered once, statically, for everyone — so the visitor's
  // own choice is read from the cookie in the browser. It is validated against
  // the live list, so a cookie naming a closed or deleted outlet reads as no
  // selection rather than as a branch that no longer exists.
  const cookieValue = useSelectedBranchId();
  const selectedId = resolveBranch(branches, cookieValue)?.id ?? null;

  // Somewhere else on the page asked for this — an Add button that could not
  // proceed without an outlet. Reading the request during render rather than
  // mirroring it into an effect keeps one source of truth for "is it open".
  const requested = useLocationPickerRequested();
  const isOpen = open || (requested && branches.length > 1);

  /** Closes from either source — a local click, or another component's request. */
  function close() {
    setOpen(false);
    clearLocationPickerRequest();
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    // Focus moves into the dialog, or a keyboard user is left behind it.
    dialogRef.current?.focus();

    // Stop the page scrolling behind the dialog. Restored to whatever it was
    // rather than hardcoded back to "", so this cannot clobber another
    // component that is also holding the scroll.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (branches.length < 2) return null;

  const selected = branches.find((branch) => branch.id === selectedId) ?? null;

  async function choose(branch) {
    if (saving) return;
    setSaving(branch.id);

    selectBranch(branch.id);

    try {
      await setCartBranch(branch.id);
    } catch {
      // The cookie is already set, so the menu switches regardless; the cart
      // reprices on its next read. Not worth an error in front of someone who
      // just picked a restaurant.
    }

    setSaving(null);
    close();
    toast.success(`Ordering from ${branch.name}.`);
    // The menu is rendered from the cookie on the server, so the page has to be
    // re-fetched for the new outlet's menu to appear.
    router.refresh();
  }

  const dialog = (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      {/* A real button, so clicking outside closes the dialog and the control
          that does it is reachable and named. */}
      <button
        type="button"
        aria-label="Close location picker"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="locations-title"
        tabIndex={-1}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-banner bg-surface-container-lowest shadow-e3 focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant px-6 py-5">
          <div>
            <h2 id="locations-title" className="font-display text-headline-md text-on-surface">
              Choose your location
            </h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Menus, prices and delivery times are set per outlet.
            </p>
          </div>

          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto p-3">
          {branches.map((branch) => {
            const isSelected = branch.id === selectedId;
            const isOpenNow = branch.openState?.isOpen;

            return (
              <li key={branch.id}>
                <button
                  type="button"
                  onClick={() => choose(branch)}
                  disabled={Boolean(saving)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`flex w-full items-start gap-3 rounded-card px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
                    isSelected ? "bg-surface-container-high" : "hover:bg-surface-container"
                  }`}
                >
                  <MapPin
                    aria-hidden="true"
                    className={`mt-1 size-4 shrink-0 ${isSelected ? "text-primary" : "text-on-surface-variant"}`}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-label-bold text-on-surface">{branch.name}</span>

                      {/* Open/closed is computed from the branch's own hours in
                          its own timezone — see `computeOpenState`. */}
                      {branch.openState ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-label-bold ${
                            isOpenNow
                              ? "bg-success-container text-on-success-container"
                              : "bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          {isOpenNow ? "Open now" : "Closed"}
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-0.5 block truncate text-body-md text-on-surface-variant">
                      {[branch.addressLine1, branch.city].filter(Boolean).join(", ") || branch.code}
                    </span>

                    {branch.phone ? (
                      <span className="block text-label-bold font-normal text-on-surface-variant">
                        {branch.phone}
                      </span>
                    ) : null}
                  </span>

                  {isSelected ? <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 rounded-full px-3 py-2 text-body-md text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <MapPin aria-hidden="true" className="size-4" />
        <span className="max-w-32 truncate">{selected ? selected.name : "Locations"}</span>
      </button>

      {/* Portalled to <body>, and that is load-bearing rather than tidiness.
          The header sets `backdrop-blur`, and an element with a
          `backdrop-filter` becomes the containing block for its fixed-position
          descendants — so `fixed inset-0` rendered in place resolves to the
          header's 64px-tall box and pins the dialog to the top of the page. The
          same rule traps it inside the header's `z-50` stacking context, where
          no z-index of its own can lift it above anything outside. Both
          problems disappear at the document root.

          No mount guard is needed: it only opens from an interaction, which
          is well after hydration. */}
      {isOpen ? createPortal(dialog, document.body) : null}
    </>
  );
}
