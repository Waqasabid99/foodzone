/**
 * URL-safe slugs. Pure — no database, so it is safe to import anywhere.
 */
export function slugify(text) {
  return String(text)
    .normalize("NFKD")
    // Strip combining accent marks left behind by the decomposition above.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Appends a short random suffix, for when uniqueness matters more than looks. */
export function slugifyWithSuffix(text, suffix) {
  const base = slugify(text);
  return base ? `${base}-${suffix}` : String(suffix);
}
