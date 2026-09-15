---
name: Sizzle & Snap
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0eded'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1b1c1c'
  on-surface-variant: '#5a4136'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0ef'
  outline: '#8e7164'
  outline-variant: '#e2bfb0'
  surface-tint: '#a04100'
  primary: '#a04100'
  on-primary: '#ffffff'
  primary-container: '#ff6b00'
  on-primary-container: '#572000'
  inverse-primary: '#ffb693'
  secondary: '#b6171e'
  on-secondary: '#ffffff'
  secondary-container: '#da3433'
  on-secondary-container: '#fffbff'
  tertiary: '#785900'
  on-tertiary: '#ffffff'
  tertiary-container: '#c19100'
  on-tertiary-container: '#402e00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcc'
  primary-fixed-dim: '#ffb693'
  on-primary-fixed: '#351000'
  on-primary-fixed-variant: '#7a3000'
  secondary-fixed: '#ffdad6'
  secondary-fixed-dim: '#ffb3ac'
  on-secondary-fixed: '#410003'
  on-secondary-fixed-variant: '#930010'
  tertiary-fixed: '#ffdf9e'
  tertiary-fixed-dim: '#fabd00'
  on-tertiary-fixed: '#261a00'
  on-tertiary-fixed-variant: '#5b4300'
  background: '#fcf9f8'
  on-background: '#1b1c1c'
  surface-variant: '#e5e2e1'
typography:
  display-lg:
    fontFamily: Montserrat
    fontSize: 64px
    fontWeight: '900'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Montserrat
    fontSize: 40px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Montserrat
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Montserrat
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Chivo
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Chivo
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-bold:
    fontFamily: Chivo
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max-width: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style

The brand personality is high-energy, indulgent, and unapologetically bold. It targets a modern, fast-paced audience looking for immediate satisfaction and visual flavor. The UI is designed to evoke appetite and urgency through a "High-Contrast / Bold" style that leans into maximalist color use and oversized imagery.

The aesthetic prioritizes food photography above all else, using "Charcoal Black" as a grounding force to make the "Energetic Orange" and "Ketchup Red" pop. Expect large-scale typography, high-saturation accents, and a tactile sense of depth that makes the digital interface feel as substantial as the food it represents.

## Colors

The palette is driven by the psychology of hunger and energy.

*   **Primary (Energetic Orange):** Used for primary actions, price points, and active states. It is the core brand identifier.
*   **Secondary (Ketchup Red):** Reserved for high-urgency notifications, "Hot" deals, and secondary brand accents.
*   **Tertiary (Mustard Yellow):** Used for highlighting specialized badges (e.g., "New," "Vegan," "Spicy") and rating stars.
*   **Neutral (Charcoal Black):** Used for high-impact typography and deep-contrast backgrounds to make the food photography feel premium.
*   **Semantic Colors:** Success is handled with a vibrant forest green (#2E7D32), while warnings use the tertiary yellow.

## Typography

This design system utilizes **Montserrat** for its chunky, geometric authority in headings, creating a "billboard" effect on every screen. **Chivo** is selected for body text and labels for its high legibility and slightly mechanical, modern feel that complements the bold headlines without competing for attention.

Headlines should utilize "ExtraBold" or "Black" weights. To maintain readability against vibrant backgrounds, ensure large headlines have sufficient padding and use the Charcoal Black or white exclusively for text color. Display sizes should be used sparingly for hero sections and promotional banners.

## Layout & Spacing

The layout follows a **Fluid Grid** model with high-impact density.
*   **Desktop:** 12-column grid with generous 24px gutters to allow the bold elements room to breathe.
*   **Mobile:** 4-column grid with 16px side margins.

Spacing follows a strict 8px base unit. Component internal padding should be generous (typically 16px or 24px) to ensure touch targets are large and the UI feels accessible. Use "Negative Spacing" (tightening the gap between a headline and its subheadline) to create strong visual groupings. Overlapping elements (e.g., a burger image slightly bleeding out of its card container) are encouraged to create a sense of movement and "freshness."

## Elevation & Depth

Depth is achieved through **Ambient Shadows** and **Tonal Layering**.
1.  **Level 0 (Base):** Pure white or light grey surface.
2.  **Level 1 (Cards):** Subtle, soft shadow (0px 4px 20px rgba(0,0,0,0.08)) to lift product cards off the background.
3.  **Level 2 (Interactive/Hover):** More pronounced shadow (0px 8px 30px rgba(0,0,0,0.12)) to signify clickability.
4.  **Level 3 (Sticky/Modals):** High-diffusion shadows to create clear separation for navigation bars and order summaries.

Avoid harsh black shadows; instead, use a slight tint of the primary orange or charcoal in the shadow color to maintain a "warm" food-centric atmosphere.

## Shapes

The design system uses a **Rounded** shape language to feel friendly and "bite-sized."
*   **Standard Elements:** 0.5rem (8px) radius for input fields and small buttons.
*   **Cards & Containers:** 1rem (16px) radius to soften the high-contrast visuals.
*   **Promotional Banners:** 1.5rem (24px) radius for a more modern, app-like feel.

Images should always carry the same border-radius as their containers. Icons should follow a rounded-cap style to match the typography.

## Components

### Buttons
*   **Primary:** Solid Energetic Orange background with white Montserrat Bold text. Use high-horizontal padding (32px).
*   **Secondary:** Solid Charcoal Black with white text for a premium "Add to Cart" feel.
*   **Ghost:** Outline in Charcoal Black with 2px stroke.

### Cards (Product)
*   White background with 1rem rounded corners and a Level 1 shadow.
*   Top half: Full-bleed high-res food photography.
*   Bottom half: Product name (Headline-MD), Price (Primary Orange), and a '+' icon button for quick add.

### Chips/Badges
*   Used for food categories (e.g., "Burgers", "Sides").
*   Capsule-shaped (Pill) with a light grey background, switching to Solid Orange on selection.

### Input Fields
*   Light grey background with no border, becoming Energetic Orange on focus.
*   Labels sit above the field in Label-Bold (Chivo).

---

## Implementation notes

The spec above is the source of truth for *intent*. These notes record where the
implementation in `src/app/globals.css` had to make a decision the spec does not
settle, and why.

### Themes

Both themes define the same semantic roles, so a component written as
`bg-surface-container text-on-surface` needs no `dark:` variants — switching the
theme swaps the values underneath it. Components should use role names, never
raw hex.

Light is the default, **including when the operating system prefers dark**. Dark
applies only when `data-theme="dark"` is set on `<html>`, so the theme is always
an explicit choice the app controls rather than something the OS imposes.

The spec gives only a light palette. The dark scheme is derived from the same
tonal palettes: the `*-fixed` roles name each hue's light and dark ends, so dark
`primary` takes the T80 tone (`primary-fixed-dim`) and dark `on-primary` takes
T20. The `*-fixed` roles themselves are identical in both themes — that is what
"fixed" means — so they are declared once.

### Saturated brand containers are held constant

`primary-container` (#ff6b00), `secondary-container` (#da3433) and
`tertiary-container` (#c19100) keep their light values in dark mode. Material's
own derivation would darken them to the T30 tone, which drains exactly the
"Energetic Orange" punch the brand is built on. They are CTA and brand surfaces,
they read correctly against both grounds, and their contrast is verified by
`npm run check:contrast`.

### Spacing stays on Tailwind's 4px step

The spec asks for a strict 8px base unit. Tailwind's spacing scale is left at
its 4px default rather than re-based to 8px, because re-basing silently changes
what every existing utility means — `p-4` would become 32px, and every snippet
of Tailwind knowledge anyone has becomes wrong. On the 4px scale the 8px rhythm
is simply the even steps: `p-2` = 8px, `p-4` = 16px, `p-6` = 24px, `p-8` = 32px.
Use even steps for layout rhythm; the odd ones are there for optical nudges.

### `rounded` cannot be re-pointed

The spec's default radius is 0.5rem, but Tailwind hardcodes bare `rounded` to
0.25rem and it cannot be redefined. The scale is therefore exposed under names
that say what they are for — `rounded-field` (0.5rem), `rounded-card` (1rem),
`rounded-banner` (1.5rem) — alongside `rounded-sm|md|lg|xl`. Use the intent
names; do not use bare `rounded`.
