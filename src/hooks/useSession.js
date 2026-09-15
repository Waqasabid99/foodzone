"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * Who is signed in, read in the browser.
 *
 * Deliberately client-side. The header lives in the root layout, so reading the
 * session cookie there with `cookies()` would opt *every* page out of static
 * generation — the home page included, which is prerendered and revalidated on
 * a five-minute schedule. Trading that for a server-rendered nav is a bad deal:
 * the nav is two buttons, and the page is the thing visitors wait for.
 *
 * The cost is one state the server cannot know: on first paint nobody is
 * identified yet. `status` exposes that honestly as "loading" so the header can
 * hold the space rather than render "Log in" and then yank it away from someone
 * who is already signed in.
 *
 * One module-level store, not one fetch per component. The header and the
 * mobile menu both want this and neither should cost a second round trip.
 */

const LOADING = Object.freeze({ status: "loading", user: null });

let state = LOADING;
let loadPromise = null;
const listeners = new Set();

function setState(next) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

/** The server always renders the unresolved state — it is the only honest one. */
function getServerSnapshot() {
  return LOADING;
}

/**
 * Fetches the current user once per page load.
 *
 * A 401 here means "no session", which is an ordinary answer rather than a
 * fault — the api client has already tried a token refresh by this point, so a
 * 401 that survives it is genuine. Anything else (offline, a 500) leaves the
 * status "unknown": showing a signed-in visitor a "Sign up" button because one
 * request failed is worse than showing nothing.
 */
export function loadSession({ force = false } = {}) {
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    try {
      const user = await api.get("/auth/me");
      setState({ status: "authenticated", user });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setState({ status: "guest", user: null });
      } else {
        setState({ status: "unknown", user: null });
      }
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/** Records a session change the client already knows about, without a round trip. */
export function setSessionUser(user) {
  setState(user ? { status: "authenticated", user } : { status: "guest", user: null });
}

export function useSession() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Only the first mount actually fetches; `loadSession` de-duplicates.
    if (state.status === "loading") loadSession();
  }, []);

  return snapshot;
}

/**
 * Ends the session.
 *
 * The logout endpoint is unauthenticated and clears the cookies whatever
 * happens, so a thrown error here is a network problem rather than a refused
 * logout — and the local state is dropped either way. Someone who clicked
 * "log out" must never be left looking at their own name.
 *
 * Navigation is left to the caller, which knows where it wants to land.
 */
export async function logoutSession() {
  try {
    await api.post("/auth/logout", {});
  } catch {
    // Deliberately swallowed — see above.
  }

  setSessionUser(null);
}
