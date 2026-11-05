/** The path the local storage driver serves uploads from — see `local.driver.js`. */
const LOCAL_MEDIA_PATH = "/api/v1/media/file/";

/** True for an upload served by our own local storage driver. */
export function isLocalMediaUrl(src) {
  if (typeof src !== "string" || !src) return false;
  try {
    // A base makes relative paths parse too; only the path matters.
    return new URL(src, "http://placeholder.invalid").pathname.startsWith(LOCAL_MEDIA_PATH);
  } catch {
    return false;
  }
}
