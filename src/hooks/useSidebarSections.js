"use client";

import { useSyncExternalStore } from "react";

/**
 * Which sidebar sections somebody has folded away.
 *
 * The staff tree is twelve sections and about seventy links, and nobody uses
 * more than two or three of them in a day: a cook never opens Finance, and an
 * accountant never opens the kitchen. Folding the rest away is the difference
 * between scanning a list and reading one.
 *
 * Stored per device in `localStorage`, like the rail's own collapsed state and
 * for the same reason — the same account on a 13" laptop and a wide monitor
 * wants different answers, so syncing it to the server would be actively wrong.
 *
 * Only *explicit* choices are stored. An absent entry means open, so a section
 * added in a later release appears rather than being silently folded away by a
 * preference written before it existed.
 *
 * `useSyncExternalStore` rather than state plus an effect, matching the theme
 * and the rail: the value is owned by the browser, and there are two copies of
 * the sidebar alive at once — the desktop rail and the mobile drawer. Component
 * state would have to be kept in step between them; a module-level store simply
 * is the same store.
 *
 * ## Why the path is in here too
 *
 * `path` is where the last toggle happened, and it is what makes arriving at a
 * page always reveal it. Without it, following a link from the overview into a
 * section somebody had folded away leaves the sidebar showing no current page
 * at all, which reads as broken.
 *
 * So while `path` does not match the page being rendered — meaning the person
 * has not touched the sidebar since arriving — the section holding the current
 * page is forced open. The moment they toggle anything, `path` catches up and
 * the force stops applying, which is what lets them fold away the section they
 * are actually in. Deriving it from a stored path rather than an effect keeps
 * it a pure function of the store, with nothing to get out of step and no
 * `setState` in an effect body.
 *
 * It is deliberately **not** persisted: after a reload you have just arrived,
 * so revealing where you are is right again.
 */

const KEY = "fz_sidebar_sections";

let state = null;
const listeners = new Set();

function read() {
  if (state) return state;

  let overrides = {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    // Defended against a hand-edited or stale value: anything that is not a
    // plain object of booleans is discarded rather than trusted into the UI.
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [id, open] of Object.entries(stored)) {
        if (typeof open === "boolean") overrides[id] = open;
      }
    }
  } catch {
    // Private mode, storage disabled, or unparseable. Everything open is the
    // safe default: nothing is hidden that somebody cannot find again.
    overrides = {};
  }

  state = { overrides, path: null };
  return state;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The server cannot know a per-device preference, so it renders every section
 * open and the browser folds them before paint if that is what was stored.
 * A stable object, because `useSyncExternalStore` compares snapshots by
 * identity and a fresh literal here would re-render forever.
 */
const SERVER_SNAPSHOT = { overrides: {}, path: null };
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function useSidebarSections() {
  return useSyncExternalStore(subscribe, read, getServerSnapshot);
}

/**
 * Folds a section away, or opens it.
 *
 * Takes the value rather than toggling, because whether a section is *currently*
 * open depends on the page being viewed — see the note above — and the caller
 * is the only one that already knows the resolved answer.
 */
export function setSidebarSection(id, open, pathname) {
  const current = read();
  const overrides = { ...current.overrides, [id]: open };
  state = { overrides, path: pathname ?? null };

  try {
    window.localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    // The preference does not survive the session. The section still folds.
  }

  for (const listener of listeners) listener();
}
