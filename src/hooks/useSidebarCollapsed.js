"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the desktop sidebar is collapsed to icons.
 *
 * A standing preference, not a per-page one: someone who works on a 13" laptop
 * collapses it once and expects it to stay collapsed tomorrow, and someone on a
 * wide monitor never touches it. Stored in `localStorage` because it is a
 * per-device convenience — the same account on a phone and a desk monitor wants
 * different answers, so syncing it to the server would be actively wrong.
 *
 * `useSyncExternalStore` rather than state plus an effect, matching the theme
 * and the branch cookie: the value is owned by the browser, not by React, and
 * reading it into state in an effect renders once with the wrong answer.
 */

const KEY = "fz_sidebar_collapsed";

let cached = null;
let loaded = false;
const listeners = new Set();

function read() {
  if (loaded) return cached;
  loaded = true;

  try {
    cached = window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode, or storage disabled. An expanded sidebar is the safe
    // default: every label is readable, nothing is hidden behind an icon.
    cached = false;
  }

  return cached;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The server has no way to know a per-device preference, so it always renders
 * the expanded sidebar and the browser collapses it before paint if that is
 * what was stored.
 */
const getServerSnapshot = () => false;

export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, read, getServerSnapshot);
}

export function toggleSidebarCollapsed() {
  cached = !read();

  try {
    window.localStorage.setItem(KEY, cached ? "1" : "0");
  } catch {
    // The preference does not survive the session. The sidebar still collapses.
  }

  for (const listener of listeners) listener();
}
