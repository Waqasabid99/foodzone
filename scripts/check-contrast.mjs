/**
 * Checks every foreground/background role pair in the theme against WCAG.
 *
 * A palette is a promise: any component that writes `bg-primary-container
 * text-on-primary-container` is trusting that the pair is readable, because
 * that is the whole point of naming roles. Nothing else enforces it — a hex
 * nudged for aesthetic reasons will not fail a build, it will just quietly
 * make a price unreadable for some of the people trying to pay you.
 *
 * Values are read out of `src/app/globals.css` rather than duplicated here, so
 * this cannot pass against a palette that no longer exists.
 *
 *   node scripts/check-contrast.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "src", "app", "globals.css"), "utf8");

// --- reading the palette out of the stylesheet --------------------------------

/** Pulls `--name: #hex;` declarations out of one block. */
function block(startPattern) {
  const start = CSS.search(startPattern);
  if (start === -1) throw new Error(`Could not find ${startPattern} in globals.css`);

  const open = CSS.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < CSS.length; end += 1) {
    if (CSS[end] === "{") depth += 1;
    else if (CSS[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const body = CSS.slice(open + 1, end);
  const values = {};
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    values[match[1]] = match[2];
  }
  return values;
}

const light = block(/^:root\s*\{/m);
const dark = block(/^\[data-theme="dark"\]\s*\{/m);
// The `*-fixed` roles are declared once, in the Tailwind layer, because they are
// identical in both themes by definition.
const fixed = Object.fromEntries(
  Object.entries(block(/^@theme inline\s*\{/m))
    .filter(([name]) => name.startsWith("color-"))
    .map(([name, value]) => [name.slice("color-".length), value]),
);

const themes = {
  light: { ...fixed, ...light },
  dark: { ...fixed, ...dark },
};

// --- WCAG --------------------------------------------------------------------

function toRgb(hex) {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
}

/** Relative luminance, per WCAG 2.1. */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light_, dark_] = a > b ? [a, b] : [b, a];
  return (light_ + 0.05) / (dark_ + 0.05);
}

// --- what has to be readable --------------------------------------------------

/**
 * `min` is the WCAG threshold that pair has to clear.
 *
 * 4.5 is normal body text. 3.0 applies where the pair is only ever used at
 * large or bold sizes, or is a boundary rather than text — an outline, or a
 * container whose own role in this design is a big headline number.
 */
const PAIRS = [
  // Surfaces and text.
  ["on-surface", "surface", 4.5],
  ["on-surface", "surface-dim", 4.5],
  ["on-surface", "surface-bright", 4.5],
  ["on-surface", "surface-container-lowest", 4.5],
  ["on-surface", "surface-container-low", 4.5],
  ["on-surface", "surface-container", 4.5],
  ["on-surface", "surface-container-high", 4.5],
  ["on-surface", "surface-container-highest", 4.5],
  ["on-surface", "surface-variant", 4.5],
  ["on-surface-variant", "surface", 4.5],
  ["on-surface-variant", "surface-container", 4.5],
  ["on-background", "background", 4.5],
  ["inverse-on-surface", "inverse-surface", 4.5],

  /*
   * Boundaries: UI components, not text.
   *
   * `outline` is what a form field is drawn with, and a field is a UI
   * component — so WCAG 1.4.11 wants 3:1 against whatever it sits on. Every
   * surface a field can land on is listed, because a field is placed on all of
   * them: on a card, on a panel inside a card, on the page itself. These used
   * to be transparent borders, which meant a field on a panel of its own fill
   * was invisible until focused.
   */
  ["outline", "surface", 3],
  ["outline", "surface-container", 3],
  ["outline", "surface-container-lowest", 3],
  ["outline", "surface-container-low", 3],
  ["outline", "surface-container-high", 3],

  /*
   * `outline-variant` draws card edges, table rules and panel dividers.
   *
   * Held to 2 rather than 3 deliberately. It separates and groups, it does not
   * identify a control, so 1.4.11's 3:1 does not apply — and taking it there
   * turns a dense table into a grid of heavy grey rules. 2:1 is the floor at
   * which the hairline is actually visible: the value before this was 1.71:1
   * against a white card, which is why cards looked like text floating on an
   * empty page.
   */
  ["outline-variant", "surface", 2],
  ["outline-variant", "surface-container-lowest", 2],
  ["outline-variant", "surface-container-low", 2],

  // Brand roles.
  ["on-primary", "primary", 4.5],
  ["on-primary-container", "primary-container", 4.5],
  ["on-secondary", "secondary", 4.5],
  ["on-secondary-container", "secondary-container", 4.5],
  ["on-tertiary", "tertiary", 4.5],
  ["on-tertiary-container", "tertiary-container", 4.5],

  // Semantic roles.
  ["on-error", "error", 4.5],
  ["on-error-container", "error-container", 4.5],
  ["on-success", "success", 4.5],
  ["on-success-container", "success-container", 4.5],
  ["on-warning", "warning", 4.5],
  ["on-warning-container", "warning-container", 4.5],

  // The focus ring is a boundary, and has to stay visible on every surface a
  // focusable element can sit on.
  ["ring", "surface", 3],
  ["ring", "surface-container", 3],
  ["ring", "surface-container-highest", 3],

  // Fixed roles keep their values in both themes, so they are checked in both.
  ["on-primary-fixed", "primary-fixed", 4.5],
  ["on-primary-fixed-variant", "primary-fixed", 4.5],
  ["on-primary-fixed", "primary-fixed-dim", 4.5],
  ["on-secondary-fixed", "secondary-fixed", 4.5],
  ["on-secondary-fixed-variant", "secondary-fixed", 4.5],
  ["on-tertiary-fixed", "tertiary-fixed", 4.5],
  ["on-tertiary-fixed-variant", "tertiary-fixed", 4.5],

  // The brand accent as text on the page, which is how prices are rendered.
  ["primary", "surface", 4.5],
  ["primary", "surface-container", 4.5],
  ["error", "surface", 4.5],
  ["secondary", "surface", 4.5],
];

const failures = [];
const warnings = [];
let checked = 0;

/**
 * Both themes must define the same roles.
 *
 * A role declared in `:root` but not in the dark block does not fall back to
 * something sensible — it keeps the light value, on a dark ground, and nobody
 * notices until someone switches themes and finds one unreadable chip.
 */
for (const [a, b] of [
  ["light", "dark"],
  ["dark", "light"],
]) {
  const source = a === "light" ? light : dark;
  const target = a === "light" ? dark : light;
  for (const role of Object.keys(source)) {
    if (!(role in target)) failures.push(`--${role} is defined in ${a} but not in ${b}`);
  }
}

for (const [themeName, palette] of Object.entries(themes)) {
  for (const [foreground, background, min] of PAIRS) {
    const fg = palette[foreground];
    const bg = palette[background];

    if (!fg || !bg) {
      failures.push(`${themeName}: ${!fg ? foreground : background} is not defined`);
      continue;
    }

    checked += 1;
    const ratio = contrast(fg, bg);
    const line = `${themeName.padEnd(5)} ${foreground} on ${background}`.padEnd(58);
    const detail = `${ratio.toFixed(2)}:1 (needs ${min})  ${fg} / ${bg}`;

    if (ratio < min) failures.push(`${line} ${detail}`);
    else if (ratio < min + 0.5) warnings.push(`${line} ${detail}`);
  }
}

console.log(`checked ${checked} pairs across ${Object.keys(themes).length} themes`);

if (warnings.length) {
  console.log(`\n${warnings.length} pair(s) only just clear the threshold:`);
  for (const warning of warnings) console.log(`  ~ ${warning}`);
}

if (failures.length) {
  console.log(`\n${failures.length} pair(s) FAIL:`);
  for (const failure of failures) console.log(`  x ${failure}`);
  process.exit(1);
}

console.log("\nevery role pair meets its contrast threshold");
