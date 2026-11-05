"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api-client";
import { playChime } from "@/lib/chime";

/**
 * The unread badge, and the list behind it.
 *
 * One module-level store, like the cart and the session: the header bell and
 * anything else that wants this read the same count without a request each.
 *
 * **Polled, not pushed.** There is no socket in this system and adding one for
 * a badge would be a server to run, a reconnect strategy and an auth story for
 * something a cheap count endpoint answers. Thirty seconds is the resolution a
 * person actually needs for "you have mail".
 *
 * **The chime fires on a rise, never on a load.** Starting a session with four
 * unread notifications is not four new notifications, and a page that greets
 * somebody with a noise about things they already knew is a page they mute.
 */

const EMPTY = Object.freeze({ status: "loading", unread: 0, items: [], listStatus: "idle", error: null });
const POLL_MS = 30_000;

let state = EMPTY;
let timer = null;
let subscribers = 0;
// `null` means "we have never counted", which is what keeps the first read
// silent however many are waiting.
let lastSeen = null;
const listeners = new Set();

function setState(next) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) start();

  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    // Nothing on screen is watching: stop asking. A background tab polling
    // every thirty seconds for hours is somebody's battery.
    if (subscribers === 0) stop();
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export async function refreshUnread() {
  try {
    const { unread } = await api.get("/me/notifications/unread-count");

    // Strictly a rise. Marking things read lowers the count and must not arm
    // the next chime to fire for a notification that already arrived.
    if (lastSeen !== null && unread > lastSeen) playChime();
    lastSeen = unread;

    setState({ status: "ready", unread, error: null });
  } catch (error) {
    // A badge is not worth an error banner. It keeps its last known count and
    // the next tick tries again.
    setState({ status: "ready", error: error.message });
  }
}

/** The recent list, for the panel. Read on open rather than on every poll. */
export async function loadNotifications() {
  /*
   * The panel has to say it is fetching. Without this it renders its empty
   * state — "Nothing new." — for however long the round trip takes, which is
   * the one thing it must not say to somebody with unread mail.
   */
  setState({ listStatus: "loading" });

  try {
    const page = await api.get("/me/notifications?limit=8", { withMeta: true });
    setState({ items: page.data ?? [], listStatus: "ready" });
  } catch (error) {
    setState({ error: error.message, listStatus: "ready" });
  }
}

export async function markAllRead() {
  const { unread } = await api.post("/me/notifications/read", {});
  lastSeen = unread ?? 0;
  setState({ unread: unread ?? 0 });
  await loadNotifications();
}

function start() {
  refreshUnread();
  timer ??= setInterval(refreshUnread, POLL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function useNotifications() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /*
   * A tab that has been hidden for an hour comes back with an hour-old count.
   * Refreshing on focus is what makes the badge true at the moment somebody
   * looks at it, which is the only moment it matters.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshUnread();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return snapshot;
}
