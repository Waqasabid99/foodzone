/**
 * Theme selection.
 *
 * Light is the default, including when the operating system prefers dark: the
 * theme is an explicit choice the app owns, not something the OS imposes. The
 * chosen theme lives on `<html data-theme>`, which is what every token in
 * `globals.css` keys off.
 */

export const THEMES = ["light", "dark"];
export const DEFAULT_THEME = "light";
export const THEME_STORAGE_KEY = "foodzone-theme";

export function isTheme(value) {
  return THEMES.includes(value);
}

/**
 * Applies the stored theme before the first paint.
 *
 * This has to run as a blocking inline script in `<head>`, not in an effect:
 * an effect runs after React hydrates, by which point the browser has already
 * painted the default light theme and a dark-theme user has seen a white flash.
 *
 * Deliberately tiny and defensive — `localStorage` throws outright in a private
 * window with site data blocked, and a theme preference is not worth breaking
 * the page over.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})()`;
