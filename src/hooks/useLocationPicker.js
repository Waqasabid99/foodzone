"use client";

import { useSyncExternalStore } from "react";

/**
 * A request to open the outlet picker, from anywhere on the page.
 *
 * The picker lives in the header, but the moment a visitor most needs it is
 * when they press Add on a menu item without having chosen an outlet. The cart
 * refuses that — correctly, because with several outlets the server cannot know
 * whose prices and whose kitchen the order belongs to — and without this the
 * refusal is a dead end: an error toast naming a choice with nothing on screen
 * to make it with.
 *
 * A module store rather than context, matching the session and cart stores: the
 * header and the menu are rendered by different trees, and threading a provider
 * around the whole app to carry one boolean is a poor trade.
 */

let requested = false;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => requested;
const getServerSnapshot = () => false;

/** Asks the header's picker to open. */
export function openLocationPicker() {
  requested = true;
  emit();
}

/** Called by the picker once it has opened, or when it closes. */
export function clearLocationPickerRequest() {
  if (!requested) return;
  requested = false;
  emit();
}

export function useLocationPickerRequested() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
