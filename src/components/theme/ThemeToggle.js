"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

/**
 * Switches between the light and dark themes.
 *
 * Renders nothing until mounted: the server cannot know the visitor's stored
 * choice, so drawing a sun that flips to a moon on hydration is worse than
 * drawing nothing for a frame. The reserved box keeps the header from shifting.
 */
export default function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();

  if (!theme) return <span className="inline-block size-10" aria-hidden="true" />;

  const goingDark = theme === "light";
  const Icon = goingDark ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={goingDark ? "Switch to dark theme" : "Switch to light theme"}
      className={`inline-flex size-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}
