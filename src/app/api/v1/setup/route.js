import { apiHandler, created, ApiError, RateLimits } from "@/lib/api";
import { bootstrapSchema } from "@/server/validation/bootstrap.schemas";
import { bootstrapInstallation, installationNeedsSetup, setupTokenMatches } from "@/server/services/bootstrap.service";
import { logger } from "@/lib/logger";

/**
 * First-run setup: creates the owner account and the first branch.
 *
 * The only unauthenticated endpoint in the system that creates an account with
 * administrative rights, so read `bootstrap.service.js` before changing
 * anything here — the guards are the whole of its security.
 *
 * **404, not 403, once setup is done.** A system that answers "forbidden" has
 * told an anonymous caller that a setup endpoint exists and that it is already
 * claimed. Not found says nothing, and is also true: there is no setup to
 * perform.
 *
 * One deliberate asymmetry: body validation runs before these guards, so a
 * malformed payload answers 400 whether or not the system is set up. That
 * reveals only that this software is running, which any deployment of it
 * shows anyway. What it must not reveal is whether the installation is
 * *unclaimed*, and it does not: a well-formed request without the right token
 * answers 404 in both states, identically.
 *
 * The token travels in a header, not the body: it stays out of the validated
 * payload, out of anything that logs a request body, and out of the schema
 * that describes what an installation is. It is compared in constant time.
 */
export const POST = apiHandler(
  { body: bootstrapSchema, rateLimit: RateLimits.auth, scope: "setup" },
  async ({ body, request, ipAddress }) => {
    if (!(await installationNeedsSetup())) throw ApiError.notFound();

    const token = request.headers.get("x-setup-token");
    if (!setupTokenMatches(token)) {
      // Logged, because on a fresh install this is either the operator getting
      // it wrong or somebody who should not be here, and both are worth seeing.
      logger.warn("setup attempted with a bad or missing token", { ipAddress });
      throw ApiError.notFound();
    }

    return created(await bootstrapInstallation(body));
  },
);
