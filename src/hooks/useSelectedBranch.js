"use client";

import { useSyncExternalStore } from "react";
import { BRANCH_COOKIE, readBranchCookie, writeBranchCookie } from "@/lib/branch";

/**
 * The selected-outlet cookie, as React state.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect, for the same
 * reason the theme uses it: the cookie is owned by the document, not by React.
 * Reading it into state in an effect means rendering once with the wrong answer
 * and then again with the right one, which React now flags outright.
 *
 * The snapshot is the raw cookie string — a primitive, so there is no
 * identity to memoise and no "getSnapshot should be cached" warning. Callers
 * resolve it against the branch list themselves, which is where the
 * validation belongs anyway.
 */

const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  // Another tab picking a different outlet should not leave this one showing
  // the old name. `storage` does not fire for cookies, so the same-document
  // write below notifies directly and this covers the cross-tab case only
  // where something else mirrors it.
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return readBranchCookie();
}

/** The server cannot know a per-visitor cookie without making the page dynamic. */
function getServerSnapshot() {
  return null;
}

export function useSelectedBranchId() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Writes the cookie and tells every mounted reader about it. */
export function selectBranch(branchId) {
  writeBranchCookie(branchId);
  for (const listener of listeners) listener();
}

export { BRANCH_COOKIE };
