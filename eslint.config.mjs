import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Builds sent elsewhere via NEXT_DIST_DIR — an e2e build kept out of the
    // dev server's way is still build output, and linting it reports 40-odd
    // problems in minified vendor code.
    ".next-*/**",
    "out/**",
    "build/**",
    // c8's HTML report, which ships its own vendored scripts. Generated
    // output, and linting it reports problems in code nobody here wrote.
    "coverage/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
