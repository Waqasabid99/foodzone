import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

/** Resolves the "@/..." alias outside Next's bundler, for plain-node tests. */
export function resolve(specifier, context, next) {
  // Next's subpath exports are resolved by its bundler, not by plain Node, so
  // point the bare specifier at the real file for tests that run outside it.
  if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
    const file = path.resolve(process.cwd(), "node_modules", `${specifier}.js`);
    if (fs.existsSync(file)) return next(pathToFileURL(file).href, context);
  }

  if (specifier.startsWith("@/")) {
    let target = path.resolve(process.cwd(), "src", specifier.slice(2));
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      if (fs.existsSync(`${target}.js`)) target += ".js";
      else if (fs.existsSync(path.join(target, "index.js"))) target = path.join(target, "index.js");
    }
    return next(pathToFileURL(target).href, context);
  }
  return next(specifier, context);
}
