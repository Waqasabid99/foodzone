import { ApiError } from "@/lib/api/errors";
import { env, isProduction } from "@/lib/env";
import { safeEqual } from "@/server/utils/crypto";

/**
 * Authorises the internal cron endpoints.
 *
 * These are machine-to-machine, so they use a shared secret rather than a user
 * session — there is no user. Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET` automatically when that variable is set; any other scheduler
 * (systemd timer, Kubernetes CronJob, GitHub Actions) sends the same header.
 *
 * Without a secret configured the endpoints refuse to run in production rather
 * than defaulting to open: an unauthenticated job trigger is a free DoS.
 */
export function assertInternalRequest(request) {
  const { CRON_SECRET } = env();

  if (!CRON_SECRET) {
    if (isProduction()) throw ApiError.notFound();
    // Locally, allow it so the worker can be exercised without extra setup.
    return { authorised: true, mode: "development" };
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token || !safeEqual(token, CRON_SECRET)) {
    // 404 rather than 401: an unauthenticated caller should not learn that
    // these endpoints exist.
    throw ApiError.notFound();
  }

  return { authorised: true, mode: "secret" };
}
