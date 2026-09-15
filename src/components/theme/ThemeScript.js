import { themeScript } from "@/lib/theme";

/**
 * Applies the stored theme before the browser paints.
 *
 * Rendered as the first thing in `<head>`. `dangerouslySetInnerHTML` is the
 * only way to emit a blocking inline script from React, and the content is a
 * constant from our own module — no user input reaches it.
 */
export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
