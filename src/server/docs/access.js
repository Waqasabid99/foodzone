import { ApiError } from "@/lib/api/errors";
import { env, isProduction } from "@/lib/env";

/**
 * Gates the API documentation endpoints.
 *
 * Open outside production, because a developer who has to set a flag to read
 * the docs will not read the docs. Closed in production unless deliberately
 * enabled: the document lists every endpoint, every permission key and every
 * payload shape, which is a map of the system for anyone probing it. That is
 * not a substitute for authorisation — every endpoint enforces its own — but
 * there is no reason to hand out the map.
 *
 * 404 rather than 403, so a probe cannot tell an enabled deployment with the
 * docs closed from one that never had them.
 */
export function assertDocsEnabled() {
  if (!isProduction()) return;
  if (env().API_DOCS_ENABLED) return;
  throw ApiError.notFound();
}
