"use client";

import { useEffect } from "react";

/**
 * The root layout itself failed.
 *
 * The only error boundary above the layout, so it reaches cases nothing else
 * can — a fonts read that threw, a crash in the providers. Correspondingly
 * rare, and correspondingly bare.
 *
 * **It renders its own document and gets none of the application's CSS.** Next
 * replaces the root layout when this is active, so `globals.css` is not loaded,
 * the design tokens do not exist, and the `data-theme` attribute the theme
 * script sets never runs. Every style here is therefore inline, and the dark
 * variant comes from `prefers-color-scheme` — the OS preference — rather than
 * from the app's own toggle, which is simply not reachable from here.
 *
 * Styled by hand rather than left as the Next default because the default says
 * nothing about an order, and "did my payment go through" is the only question
 * somebody seeing this actually has.
 *
 * `<title>` is a React element rather than a metadata export: this is a Client
 * Component, and `metadata` is not supported in one.
 */
export default function GlobalError({ error, retry }) {
  useEffect(() => {
    console.error("global error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem 1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <title>Something went wrong — FoodZone</title>

        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Something went wrong</h1>

        <p style={{ margin: 0, maxWidth: "32rem", lineHeight: 1.6, opacity: 0.8 }}>
          The site failed to load. Any order you have already placed is unaffected, and nothing has been charged
          because of this.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              cursor: "pointer",
              border: "1px solid currentColor",
              borderRadius: "999px",
              background: "transparent",
              color: "inherit",
              font: "inherit",
              fontWeight: 600,
              padding: "0.75rem 1.5rem",
            }}
          >
            Try again
          </button>

          {/*
            * A plain anchor, deliberately.
            *
            * `next/link` does a client-side navigation through the router, and
            * the router lives in the tree this boundary has just replaced. A
            * full document load is the only navigation that can be trusted
            * from here, which is exactly what an anchor does.
            */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              borderRadius: "999px",
              border: "1px solid currentColor",
              padding: "0.75rem 1.5rem",
              fontWeight: 600,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            Go home
          </a>
        </div>

        {error?.digest ? (
          <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.6 }}>Reference {error.digest}</p>
        ) : null}
      </body>
    </html>
  );
}
