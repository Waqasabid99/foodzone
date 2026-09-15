"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isTheme } from "@/lib/theme";

/**
 * Reads and sets the active theme.
 *
 * The theme lives on `<html data-theme>`, put there by the inline script in
 * `<head>` before the first paint. That makes it external state that React does
 * not own, which is precisely what `useSyncExternalStore` is for — reading it
 * into `useState` inside an effect would re-render every consumer a second time
 * on mount for no reason.
 *
 * `getServerSnapshot` returns null, so server rendering and hydration both see
 * "not known yet" and agree; the real value arrives immediately afterwards.
 * Callers should treat null as "render nothing theme-dependent".
 */

const THEME_EVENT = "foodzone:themechange";

function subscribe(onChange) {
  // Same tab: our own writes. Other tabs: the storage event.
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot() {
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : DEFAULT_THEME;
}

function getServerSnapshot() {
  return null;
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next) => {
    if (!isTheme(next)) return;

    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A blocked storage API costs the preference on the next visit, nothing more.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const toggle = useCallback(() => {
    setTheme(getSnapshot() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
