/**
 * Validates the generated document against the OpenAPI 3.1 specification.
 *
 * Run in CI alongside the generator: a spec that Swagger UI renders is not the
 * same as a spec a client generator will accept, and the difference only
 * surfaces when someone tries to build against it.
 */
import fs from "node:fs";
import path from "node:path";
import { validate, compileErrors } from "@readme/openapi-parser";

const file = path.resolve(import.meta.dirname, "..", "..", "src", "generated", "openapi.json");

const result = await validate(file);

if (!result.valid) {
  console.error("openapi validation failed:\n");
  console.error(compileErrors(result));
  process.exit(1);
}

const api = JSON.parse(fs.readFileSync(file, "utf8"));
const operations = Object.values(api.paths).reduce(
  (total, item) => total + Object.keys(item).filter((key) => key !== "parameters").length,
  0,
);

console.log(`valid OpenAPI ${api.openapi} — ${Object.keys(api.paths).length} paths, ${operations} operations`);
