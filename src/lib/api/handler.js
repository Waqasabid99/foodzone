import { after } from "next/server";
import { ApiError, ErrorCode, fromPrismaError } from "@/lib/api/errors";
import { ok, fail, failFrom } from "@/lib/api/response";
import { parseBody, parseQuery, parseParams } from "@/lib/api/validate";
import { requestContext } from "@/lib/api/request";
import { getAuthContext } from "@/lib/api/auth";
import { assertPermission, assertRole } from "@/lib/api/permissions";
import { assertBranchAccess } from "@/lib/api/auth";
import { defaultRateLimitKey, enforceRateLimit, rateLimitHeaders, RateLimits } from "@/lib/api/rate-limit";
import { recordAudit } from "@/server/utils/audit";
import { invalidate } from "@/lib/revalidate";
import { logger } from "@/lib/logger";

/**
 * The one wrapper every route handler uses.
 *
 * It composes the cross-cutting concerns in the only order that is safe:
 * rate limit (cheapest, protects everything behind it) -> authenticate ->
 * resolve branch -> authorise -> validate input -> run. Doing authorisation
 * before validation matters: an unauthorised caller must not be able to probe
 * the shape of a payload through validation errors.
 *
 * Authorisation deliberately lives HERE and not in proxy.js. Next's own docs
 * warn that a matcher change or a moved route silently removes proxy coverage,
 * so proxy handles CORS only and every route states its own requirements.
 *
 *   export const POST = apiHandler(
 *     {
 *       auth: true,
 *       permissions: "products.create",
 *       branch: "body",
 *       body: createProductSchema,
 *       rateLimit: RateLimits.write,
 *       audit: { action: "product.create", entityType: "Product" },
 *     },
 *     async ({ body, auth, branchId }) => created(await createProduct(body, auth)),
 *   );
 *
 * The handler receives one context object and may return either a Response or
 * a plain value, which is wrapped in the success envelope.
 *
 * An optional `doc` key is ignored at runtime and read by the OpenAPI
 * generator. Everything it can work out for itself — parameters, request
 * bodies, permissions, branch scoping, rate limits — it does; `doc` is for the
 * parts it cannot: `{ summary, description, tag, deprecated, response }`, where
 * `response` is a zod schema for the payload inside `data`.
 *
 * `invalidates` names the cache tags a successful call makes stale —
 * `invalidates: [CacheTag.CATALOG]`. It is declared beside `audit` rather than
 * called inside the handler body because a write that forgets to clear the
 * storefront cache fails silently: the save works and the website shows the old
 * value for minutes. As an option it is visible in review next to the
 * permission, and it only fires when the call succeeded.
 */
/**
 * The handful of calls that still work while a password change is owed:
 * changing it, seeing who you are, and signing out.
 *
 * Methods are named because reading your own profile has to keep working —
 * the screen that asks for a new password greets you by name — while editing
 * it does not.
 */
const PASSWORD_CHANGE_ALLOWED = [
  { path: "/api/v1/auth/password/change", methods: ["POST"] },
  { path: "/api/v1/auth/password/reset", methods: ["POST"] },
  { path: "/api/v1/auth/logout", methods: ["POST"] },
  { path: "/api/v1/auth/refresh", methods: ["POST"] },
  { path: "/api/v1/me", methods: ["GET"] },
];

function isPasswordChangePath(request) {
  try {
    const { pathname } = new URL(request.url);
    const clean = pathname.replace(/\/$/, "");
    const method = String(request.method ?? "GET").toUpperCase();
    return PASSWORD_CHANGE_ALLOWED.some((entry) => entry.path === clean && entry.methods.includes(method));
  } catch {
    return false;
  }
}

export function apiHandler(options, handler) {
  // apiHandler(fn) — no options.
  if (typeof options === "function") {
    handler = options;
    options = {};
  }

  const {
    auth = false,
    permissions = null,
    anyPermission = false,
    roles = null,
    branch = null,
    body: bodySchema = null,
    query: querySchema = null,
    params: paramsSchema = null,
    rateLimit = null,
    audit = null,
    invalidates = null,
    maxBodyBytes,
  } = options;

  const wrapped = async (request, context) => {
    const ctx = requestContext(request);
    let limitResult = null;

    try {
      if (rateLimit !== false && rateLimit) {
        try {
          limitResult = await applyRateLimit({ request, rateLimit, options, ctx });
        } catch (error) {
          // Carry the reading onto the 429 as well. A client told only "too
          // many requests" has to guess when to come back.
          if (error?.rateLimit) limitResult = error.rateLimit;
          throw error;
        }
      }

      // --- authenticate --------------------------------------------------
      const principal = auth ? await getAuthContext(request) : null;
      if (auth === true && !principal) throw ApiError.unauthorized();

      // An account holding a temporary password an administrator read out may
      // do one thing: choose its own. Enforced here rather than in the screens
      // alone, because the API is what the phone app and any script talk to.
      if (principal?.mustChangePassword && !isPasswordChangePath(request)) {
        throw ApiError.forbidden("Choose a new password before carrying on", {
          code: "PASSWORD_CHANGE_REQUIRED",
          mustChangePassword: true,
        });
      }

      // Rate limit again by identity once we know who is calling, so a signed-in
      // caller is not sharing an anonymous IP bucket.
      if (rateLimit && principal && !limitResult?.identified) {
        limitResult = await applyRateLimit({ request, rateLimit, options, ctx, principal });
      }

      // --- input ----------------------------------------------------------
      const params = paramsSchema ? await parseParams(context, paramsSchema) : ((await context?.params) ?? {});
      const query = querySchema ? parseQuery(request, querySchema) : undefined;
      const parsedBody = bodySchema ? await parseBody(request, bodySchema, { maxBytes: maxBodyBytes }) : undefined;

      if (parsedBody?.client) ctx.client = String(parsedBody.client).toUpperCase();

      // --- authorise -------------------------------------------------------
      const branchId = resolveBranchId({ branch, params, query, body: parsedBody, principal });

      if (principal && branchId && branch) {
        assertBranchAccess(principal, branchId, Array.isArray(permissions) ? permissions[0] : permissions);
      }
      if (roles) assertRole(principal, roles);
      if (permissions) assertPermission(principal, permissions, { branchId, any: anyPermission });

      // --- run --------------------------------------------------------------
      const result = await handler({
        request,
        context,
        params,
        query,
        body: parsedBody,
        auth: principal,
        branchId,
        ...ctx,
      });

      const response = result instanceof Response ? result : ok(result);
      applyHeaders(response, ctx, limitResult);

      // Before the response returns, not in `after()`: the admin screen
      // refreshes the moment it gets a 2xx, and a refresh that races the
      // invalidation reads the value it just replaced.
      if (invalidates?.length && response.ok) invalidate(...invalidates);

      if (audit && principal) {
        // Fire-and-forget after the response is sent — auditing must not add
        // latency to the request it describes.
        after(() =>
          recordAudit({
            actorId: principal.userId,
            branchId,
            action: audit.action,
            entityType: audit.entityType,
            entityId: typeof audit.entityId === "function" ? audit.entityId({ result, params }) : params?.id ?? null,
            changes: audit.changes ?? null,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          }),
        );
      }

      return response;
    } catch (error) {
      return toErrorResponse(error, { request, ctx, limitResult });
    }
  };

  // The options are the only complete statement of what a route accepts and who
  // may call it, so the OpenAPI document is generated by reading them back
  // rather than written by hand — a spec maintained in a separate file drifts
  // from the pipeline the moment anyone edits a schema. Non-enumerable so it
  // stays invisible to anything that iterates the module's exports.
  Object.defineProperty(wrapped, "apiSpec", { value: options, enumerable: false });

  return wrapped;
}

/**
 * Back-compatible wrapper with the original `(request, context)` signature.
 * Same error mapping, no pipeline. Prefer `apiHandler` for new routes.
 */
export function handle(handler) {
  return async (request, context) => {
    const ctx = requestContext(request);
    try {
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error, { request, ctx });
    }
  };
}

async function applyRateLimit({ request, rateLimit, options, ctx, principal = null }) {
  const config = typeof rateLimit === "string" ? RateLimits[rateLimit] : rateLimit;
  if (!config) return null;

  const scope = config.scope ?? options.scope ?? new URL(request.url).pathname;
  const key = config.key
    ? config.key({ request, principal, scope, ctx })
    : defaultRateLimitKey({ request, principal, scope });

  const result = await enforceRateLimit(key, config);
  return { ...result, identified: Boolean(principal) };
}

/**
 * Where the branch id comes from. Staff endpoints are branch-scoped, so this
 * is what every permission check is measured against.
 */
function resolveBranchId({ branch, params, query, body, principal }) {
  if (!branch) return null;
  if (typeof branch === "function") return branch({ params, query, body, principal }) ?? null;

  const field = typeof branch === "string" && branch.includes(":") ? branch.split(":")[1] : "branchId";

  if (branch === "param" || branch.startsWith("param:")) return params?.[field] ?? null;
  if (branch === "query" || branch.startsWith("query:")) return query?.[field] ?? null;
  if (branch === "body" || branch.startsWith("body:")) return body?.[field] ?? null;

  // A literal branch id.
  return branch;
}

function applyHeaders(response, ctx, limitResult) {
  response.headers.set("x-request-id", ctx.requestId);
  for (const [key, value] of Object.entries(rateLimitHeaders(limitResult))) {
    response.headers.set(key, value);
  }
  return response;
}

function toErrorResponse(error, { request, ctx, limitResult }) {
  // The method decides how a dropped connection is described: after a write,
  // "try again" is advice that creates duplicates.
  const apiError = error instanceof ApiError ? error : fromPrismaError(error, { method: request.method });

  if (apiError) {
    // 4xx are normal traffic; only log the server's own faults loudly.
    logger.warn("api error", {
      requestId: ctx.requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      code: apiError.code,
      status: apiError.status,
    });

    const response = failFrom(apiError);
    return applyHeaders(response, ctx, limitResult);
  }

  // A driver error can arrive with an empty `message` — a dropped connection
  // through a serverless pooler is the usual one — and logging only the message
  // then produces an entry that says nothing at all. The vendor code and meta
  // are the only parts that identify it, so they are logged too.
  logger.error("unhandled api error", {
    requestId: ctx.requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    name: error?.name,
    code: error?.code ?? null,
    meta: error?.meta ?? null,
    error: error?.message || "(no message)",
    stack: error?.stack,
  });

  // Never leak an internal message or stack to the client.
  const response = fail(ErrorCode.INTERNAL_ERROR, "Something went wrong", {
    details: { requestId: ctx.requestId },
  });
  return applyHeaders(response, ctx, limitResult);
}
