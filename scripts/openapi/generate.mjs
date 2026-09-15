/**
 * Builds the OpenAPI 3.1 document by importing every route module and reading
 * the options each one handed to `apiHandler`.
 *
 * Those options are already the authoritative statement of what a route
 * accepts and who may call it — the pipeline enforces nothing else — so
 * generating from them is the only way the document cannot quietly disagree
 * with the server. A hand-written spec is wrong the first time someone edits a
 * zod schema and forgets.
 *
 *   node --import ./tests/register-loader.mjs scripts/openapi/generate.mjs
 *
 * What is NOT derived: response payload shapes. Services return Prisma rows
 * chosen by `select`, and there is no schema object to read, so successful
 * responses are documented as the envelope with a free-form `data`. A route may
 * declare `doc: { response: someZodSchema }` to publish a real one, and this
 * generator will use it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { TAGS, tagFor, PHRASE, SINGULAR, ACTION_SEGMENTS, ROOT_SEGMENTS, SUMMARY_OVERRIDES } from "./taxonomy.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const API_DIR = path.join(ROOT, "src", "app", "api");
const OUT_FILE = path.join(ROOT, "src", "generated", "openapi.json");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** The documentation endpoints describe the API; they are not part of it. */
const EXCLUDED = [/^\/api\/docs(\/|$)/];

const warnings = [];
const usedOverrides = new Set();

// --- filesystem -------------------------------------------------------------

function routeFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, acc);
    else if (entry.name === "route.js") acc.push(full);
  }
  return acc;
}

/** `.../api/v1/admin/products/[id]/route.js` -> `/api/v1/admin/products/{id}`. */
function toApiPath(file) {
  const rel = path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
  return `/api/${rel}`
    .replace(/\[\.\.\.(\w+)\]/g, "{$1}")
    .replace(/\[(\w+)\]/g, "{$1}");
}

function pathParamNames(apiPath) {
  return [...apiPath.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

function catchAllNames(file) {
  return [...file.matchAll(/\[\.\.\.(\w+)\]/g)].map((m) => m[1]);
}

/**
 * Splits a route file into the source of each exported method, so response
 * helpers can be read per operation rather than per file.
 */
function methodSources(source) {
  const marks = [...source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g)];
  const parts = {};
  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].index : source.length;
    parts[mark[1]] = source.slice(mark.index, end);
  });
  return parts;
}

/**
 * The block comment immediately above an export, used as the operation's
 * description.
 *
 * Matched by scanning backwards from the export rather than forwards from the
 * first comment in the file: a forward search finds the file's earliest comment
 * and attributes it to whichever method happens to be exported last.
 */
function docCommentAbove(source, method) {
  const anchor = source.search(new RegExp(`export\\s+const\\s+${method}\\s*=`));
  if (anchor === -1) return null;

  const before = source.slice(0, anchor).trimEnd();
  if (!before.endsWith("*/")) return null;

  const start = before.lastIndexOf("/**");
  if (start === -1) return null;
  // Only a comment that is genuinely adjacent, not one separated by code.
  if (before.slice(start).includes("\n\n")) return null;

  return before
    .slice(start + 3, before.length - 2)
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trimEnd())
    .join("\n")
    .trim();
}

// --- naming -----------------------------------------------------------------

function words(segment) {
  // An irregular is used verbatim, so acronyms keep their case ("QR codes").
  return PHRASE[segment] ?? segment.replace(/-/g, " ").toLowerCase();
}

function singular(phrase) {
  const parts = phrase.split(" ");
  const last = parts.pop();
  parts.push(singularWord(last));
  return parts.join(" ");
}

function singularWord(word) {
  if (SINGULAR[word]) return SINGULAR[word];
  if (/(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  // "addresses" -> "address", "taxes" -> "tax", "batches" -> "batch", "statuses" -> "status".
  if (/(sses|xes|zes|ches|shes|uses)$/.test(word)) return word.slice(0, -2);
  // "expenses" -> "expense", not "expens".
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** A segment naming many of something: "categories" yes, "cart" no. */
function isPlural(phrase) {
  return singular(phrase) !== phrase;
}

function sentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const isParam = (segment) => Boolean(segment) && segment.startsWith("{");

function article(word) {
  // Spelling is not the test — "a user", "a unit". These are the initial
  // sounds in this vocabulary that read as a consonant despite the vowel.
  if (/^(uni|use|usu|uti|eu|one)/i.test(word)) return "a";
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function withArticle(noun) {
  return `${article(noun)} ${noun}`;
}

/**
 * A readable summary from the shape of the path.
 *
 * Two signals do most of the work: whether a segment is a path parameter, and
 * whether the handler returned `paginated(...)` — which is what separates a
 * collection ("List orders") from a singleton read ("Get the cart"). Segments
 * that name an action rather than a resource are listed in the taxonomy,
 * because nothing in the path distinguishes them.
 */
function deriveSummary(method, segments, { paginated }) {
  const override = SUMMARY_OVERRIDES[`${method} /api/${segments.join("/")}`];
  if (override) {
    usedOverrides.add(`${method} /api/${segments.join("/")}`);
    return override;
  }

  if (segments[0] === "internal") {
    return sentence(`run the ${words(segments.at(-1))} job`);
  }

  const parts = segments.filter((segment) => segment !== "v1");
  const last = parts.at(-1);
  const previous = parts.at(-2);

  // /admin/products/{id} — an operation on one record.
  if (isParam(last)) {
    // `.../menus/{id}/items/{itemId}` — name the owner too, or every nested
    // update reads as "Update an item".
    const grandparent = isParam(parts.at(-3)) && parts.at(-4) ? parts.at(-4) : null;
    const subject =
      withArticle(singular(words(previous ?? "resource"))) +
      (grandparent ? ` of ${withArticle(singular(words(grandparent)))}` : "");
    if (method === "GET") return sentence(`get ${subject}`);
    if (method === "DELETE") return sentence(`delete ${subject}`);
    if (method === "PUT") return sentence(`replace ${subject}`);
    if (method === "PATCH") return sentence(`update ${subject}`);
    return sentence(`act on ${subject}`);
  }

  const noun = words(last);

  // /admin/orders/{id}/cancel — an action or sub-resource under one record.
  if (previous && isParam(previous)) {
    const owner = withArticle(singular(words(parts.at(-3) ?? "resource")));
    if (ACTION_SEGMENTS.has(last)) return sentence(`${noun} ${owner}`);
    if (method === "GET") return sentence(`${paginated || isPlural(noun) ? "list" : "get"} the ${noun} of ${owner}`);
    if (method === "POST") return sentence(`add ${withArticle(singular(noun))} to ${owner}`);
    if (method === "PUT" || method === "PATCH") return sentence(`set the ${noun} of ${owner}`);
    if (method === "DELETE") return sentence(`remove the ${noun} of ${owner}`);
    return sentence(`${method.toLowerCase()} the ${noun} of ${owner}`);
  }

  // /auth/password/reset — an action hanging off a resource or a module root.
  if (ACTION_SEGMENTS.has(last)) {
    if (!previous || ROOT_SEGMENTS.has(previous)) return sentence(noun);
    return sentence(`${noun} ${withArticle(singular(words(previous)))}`);
  }

  if (method === "GET") return sentence(paginated || isPlural(noun) ? `list ${noun}` : `get the ${noun}`);
  if (method === "POST") return sentence(`create ${withArticle(singular(noun))}`);
  if (method === "PUT") return sentence(`replace the ${noun}`);
  if (method === "PATCH") return sentence(`update the ${noun}`);
  if (method === "DELETE") return sentence(`delete the ${noun}`);
  return sentence(`${method.toLowerCase()} the ${noun}`);
}

function camel(parts) {
  return parts
    .map((part, index) =>
      part
        .split("-")
        .map((word, wordIndex) =>
          index === 0 && wordIndex === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(""),
    )
    .join("");
}

function operationId(method, segments) {
  const parts = segments
    .filter((segment) => segment !== "v1")
    .map((segment) => (isParam(segment) ? `by-${segment.slice(1, -1)}` : segment));
  return camel([method.toLowerCase(), ...parts]);
}

// --- zod --------------------------------------------------------------------

function jsonSchema(schema, where) {
  try {
    const converted = z.toJSONSchema(schema, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "inline",
      cycles: "ref",
    });
    delete converted.$schema;
    return converted;
  } catch (error) {
    warnings.push(`${where}: could not convert schema (${error.message})`);
    return { type: "object", description: "Schema could not be derived automatically." };
  }
}

// --- operation assembly -----------------------------------------------------

const RATE_LIMIT_NAMES = new Map();

function describeRateLimit(rateLimit) {
  if (!rateLimit || typeof rateLimit !== "object") return null;
  const { limit, windowMs } = rateLimit;
  if (typeof limit !== "number" || typeof windowMs !== "number") return null;
  const seconds = Math.round(windowMs / 1000);
  const window = seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
  return { limit, window, name: RATE_LIMIT_NAMES.get(rateLimit) ?? null };
}

function describeBranch(branch) {
  if (!branch) return null;
  if (typeof branch === "function") return "resolved by the route from the request";
  const [source, field = "branchId"] = String(branch).split(":");
  if (source === "param") return `path parameter \`${field}\``;
  if (source === "query") return `query parameter \`${field}\``;
  if (source === "body") return `body field \`${field}\``;
  return `fixed to \`${branch}\``;
}

function buildOperation({ method, apiPath, segments, spec, source, fileSource, file }) {
  const doc = spec.doc ?? {};
  const permissions = spec.permissions ? [].concat(spec.permissions) : [];
  const isInternal = segments[0] === "internal";
  const rateLimit = describeRateLimit(spec.rateLimit);
  const branch = describeBranch(spec.branch);

  const notes = [];
  if (isInternal) {
    notes.push(
      "Machine-to-machine. Send `Authorization: Bearer $CRON_SECRET`; an unauthorised caller receives 404 rather than 401, so the endpoint's existence is not disclosed.",
    );
  } else if (spec.auth === true) {
    notes.push("Requires an authenticated caller.");
  } else if (/optionalAuth\(/.test(source)) {
    notes.push("Public. A signed-in caller receives a personalised response; anonymous callers are identified by their session cookie.");
  } else {
    notes.push("Public — no authentication required.");
  }

  if (permissions.length) {
    const keys = permissions.map((key) => `\`${key}\``).join(", ");
    notes.push(
      permissions.length === 1
        ? `Requires the permission ${keys}.`
        : `Requires ${spec.anyPermission ? "any of" : "all of"} the permissions ${keys}.`,
    );
  }
  if (spec.roles) notes.push(`Restricted to role${[].concat(spec.roles).length > 1 ? "s" : ""} ${[].concat(spec.roles).map((r) => `\`${r}\``).join(", ")}.`);
  if (branch) notes.push(`Branch-scoped: the branch is taken from the ${branch}, and access to it is checked before the handler runs.`);
  if (rateLimit) notes.push(`Rate limit: ${rateLimit.limit} requests per ${rateLimit.window}${rateLimit.name ? ` (\`${rateLimit.name}\` class)` : ""}.`);
  if (spec.audit) notes.push(`Audited as \`${spec.audit.action}\`.`);

  const routeDoc = doc.description ?? docCommentAbove(fileSource, method);
  const description = [routeDoc, notes.join(" ")].filter(Boolean).join("\n\n");

  // --- parameters -----------------------------------------------------------
  const parameters = [];
  const paramSchema = spec.params ? jsonSchema(spec.params, `${apiPath} ${method} params`) : null;

  const catchAll = new Set(catchAllNames(file));
  for (const name of pathParamNames(apiPath)) {
    const declared = paramSchema?.properties?.[name];
    parameters.push({
      name,
      in: "path",
      required: true,
      // A catch-all segment arrives as an array of segments; over the wire it is
      // simply the remaining path, so it is documented as a slash-joined string.
      ...(catchAll.has(name) ? { description: "May contain `/` — the remainder of the path." } : {}),
      schema: declared ?? { type: "string" },
    });
  }

  if (spec.query) {
    const converted = jsonSchema(spec.query, `${apiPath} ${method} query`);
    const required = new Set(converted.required ?? []);
    for (const [name, schema] of Object.entries(converted.properties ?? {})) {
      const { description: fieldDescription, ...rest } = schema ?? {};
      parameters.push({
        name,
        in: "query",
        required: required.has(name),
        ...(fieldDescription ? { description: fieldDescription } : {}),
        schema: rest,
      });
    }
    if (converted.additionalProperties === undefined && !converted.properties) {
      warnings.push(`${method} ${apiPath}: query schema produced no properties`);
    }
  }

  // --- request body ---------------------------------------------------------
  let requestBody;
  if (spec.body) {
    requestBody = {
      required: true,
      content: { "application/json": { schema: jsonSchema(spec.body, `${apiPath} ${method} body`) } },
    };
  }

  // --- responses ------------------------------------------------------------
  const responses = {};
  const isPaginated = /\bpaginated\(/.test(source);
  const isCreated = /\bcreated\(/.test(source);
  const isNoContent = /\bnoContent\(/.test(source);
  const isRaw = /new NextResponse\(|new Response\(/.test(source);

  const dataSchema = doc.response
    ? jsonSchema(doc.response, `${apiPath} ${method} response`)
    : isPaginated
      ? { type: "array", items: { type: "object", additionalProperties: true } }
      : { type: "object", additionalProperties: true };

  if (isNoContent) {
    responses["204"] = { description: "Deleted. No body." };
  } else if (isRaw && !/\bok\(|\bcreated\(|\bpaginated\(/.test(source)) {
    responses["200"] = { description: "Raw response — see the endpoint notes; not the JSON envelope." };
  } else {
    const status = isCreated ? "201" : "200";
    responses[status] = {
      description: isCreated ? "Created." : "Success.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["success", "data"],
            properties: {
              success: { const: true },
              data: dataSchema,
              ...(isPaginated ? { meta: { $ref: "#/components/schemas/PageMeta" } } : {}),
            },
          },
        },
      },
    };
  }

  if (spec.body || spec.query || spec.params) responses["400"] = { $ref: "#/components/responses/ValidationError" };
  if (spec.auth === true && !isInternal) responses["401"] = { $ref: "#/components/responses/Unauthorized" };
  if (permissions.length || spec.roles || spec.branch) responses["403"] = { $ref: "#/components/responses/Forbidden" };
  if (pathParamNames(apiPath).length || isInternal) responses["404"] = { $ref: "#/components/responses/NotFound" };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) responses["409"] = { $ref: "#/components/responses/Conflict" };
  if (spec.rateLimit) responses["429"] = { $ref: "#/components/responses/RateLimited" };
  responses["500"] = { $ref: "#/components/responses/ServerError" };

  const operation = {
    operationId: operationId(method, segments),
    summary: doc.summary ?? deriveSummary(method, segments, { paginated: isPaginated }),
    description,
    tags: [doc.tag ?? tagFor(segments)],
    ...(doc.deprecated ? { deprecated: true } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  };

  if (isInternal) operation.security = [{ cronSecret: [] }];
  else if (spec.auth === true) operation.security = [{ bearerAuth: [] }, { cookieAuth: [] }];
  else operation.security = [];

  if (permissions.length) operation["x-permissions"] = permissions;
  if (rateLimit) operation["x-rate-limit"] = { limit: rateLimit.limit, window: rateLimit.window };
  if (spec.audit?.action) operation["x-audit-action"] = spec.audit.action;
  operation["x-source"] = path.relative(ROOT, file);

  return operation;
}

// --- document ---------------------------------------------------------------

async function build() {
  const { RateLimits } = await import("@/lib/api/rate-limit");
  for (const [name, config] of Object.entries(RateLimits)) RATE_LIMIT_NAMES.set(config, name);

  const files = routeFiles(API_DIR).sort();
  const paths = {};
  const seenOperationIds = new Map();
  let operationCount = 0;

  for (const file of files) {
    const apiPath = toApiPath(file);
    if (EXCLUDED.some((pattern) => pattern.test(apiPath))) continue;
    const segments = apiPath.replace(/^\/api\//, "").split("/");
    const source = fs.readFileSync(file, "utf8");
    const perMethod = methodSources(source);

    let routeModule;
    try {
      routeModule = await import(pathToFileURL(file).href);
    } catch (error) {
      warnings.push(`${apiPath}: failed to import (${error.message})`);
      continue;
    }

    for (const method of HTTP_METHODS) {
      const handler = routeModule[method];
      if (typeof handler !== "function") continue;

      // A handful of routes cannot use `apiHandler` — the ones that return a
      // file rather than the JSON envelope. They declare themselves instead.
      const spec = handler.apiSpec ?? routeModule.apiDoc?.[method];
      if (!spec) {
        warnings.push(`${method} ${apiPath}: no apiSpec and no apiDoc entry — not wrapped in apiHandler?`);
        continue;
      }

      const operation = buildOperation({
        method,
        apiPath,
        segments,
        spec,
        source: perMethod[method] ?? source,
        fileSource: source,
        file,
      });

      const clash = seenOperationIds.get(operation.operationId);
      if (clash) warnings.push(`duplicate operationId ${operation.operationId} (${clash} and ${method} ${apiPath})`);
      seenOperationIds.set(operation.operationId, `${method} ${apiPath}`);

      paths[apiPath] ??= {};
      paths[apiPath][method.toLowerCase()] = operation;
      operationCount += 1;
    }
  }

  const document = {
    openapi: "3.1.1",
    info: {
      title: "FoodZone API",
      version: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version,
      summary: "One backend for the FoodZone website and mobile app.",
      description: INFO_DESCRIPTION,
      license: { name: "UNLICENSED", identifier: "UNLICENSED" },
    },
    servers: [
      { url: "http://localhost:3000", description: "Local development" },
      { url: "{origin}", description: "Deployment", variables: { origin: { default: "https://example.com" } } },
    ],
    tags: TAGS.map(([name, description]) => ({ name, description })),
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: components(),
  };

  for (const key of Object.keys(SUMMARY_OVERRIDES)) {
    if (!usedOverrides.has(key)) warnings.push(`stale SUMMARY_OVERRIDES entry: ${key} matches no route`);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(document, null, 2)}\n`);

  return { operationCount, pathCount: Object.keys(paths).length, fileCount: files.length };
}

const INFO_DESCRIPTION = `
Every response uses one of two envelopes, so a client never has to branch on
content type:

\`\`\`json
{ "success": true,  "data": {}, "meta": {} }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {} } }
\`\`\`

Clients must branch on \`error.code\`, never on \`error.message\`. Codes are a
public contract and are only ever added, never repurposed; messages are reworded
freely.

**Authentication** is either \`Authorization: Bearer <access token>\` (mobile) or
the \`fz_access\` httpOnly cookie (web). Both resolve to the same principal.
Access tokens are short-lived; \`POST /api/v1/auth/refresh\` rotates them.

**Authorisation** is per route, stated by the route itself, and composed in a
fixed order: rate limit → authenticate → resolve branch → authorise → validate →
run. Authorisation deliberately runs before validation, so an unauthorised
caller cannot map a payload's shape through validation errors.

**Branch scoping.** Most staff endpoints act at one branch. Where the branch
comes from is listed on each operation, and access to it is checked before the
handler runs.

**Pagination** is cursor-based. A list returns \`meta.nextCursor\`; pass it back as
\`cursor\` to fetch the next page. \`meta.nextCursor\` is \`null\` on the last page.

**Rate limiting.** Responses carry \`RateLimit-Limit\`, \`RateLimit-Remaining\` and
\`RateLimit-Reset\`; a 429 additionally carries \`Retry-After\`.

**Tracing.** Every response carries \`x-request-id\`. Quote it when reporting a
fault — a 500 returns the same id in \`error.details.requestId\`.

**Money** is serialised as a decimal string, never a float, to avoid the
representation errors floats introduce in currency arithmetic.

> **On response bodies:** success payloads are generated as free-form objects.
> The shape of a response comes from Prisma \`select\` clauses inside the service
> layer, and there is no schema object to read back, so publishing a guessed
> shape would be worse than publishing none. Request bodies, query strings and
> path parameters are all exact — they are generated from the same zod schemas
> the server validates with.
`.trim();

function components() {
  const errorSchema = {
    type: "object",
    required: ["success", "error"],
    properties: {
      success: { const: false },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { $ref: "#/components/schemas/ErrorCode" },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
      },
    },
  };

  const errorResponse = (description, headers) => ({
    description,
    ...(headers ? { headers } : {}),
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });

  const requestId = {
    description: "Identifies this request in the server logs.",
    schema: { type: "string" },
  };

  return {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access token issued by `/api/v1/auth/login`. Used by the mobile app.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "fz_access",
        description: "httpOnly access-token cookie set by `/api/v1/auth/login`. Used by the website.",
      },
      cronSecret: {
        type: "http",
        scheme: "bearer",
        description: "`CRON_SECRET` shared secret for the internal scheduler endpoints.",
      },
    },
    schemas: {
      ErrorCode: {
        type: "string",
        enum: [
          "VALIDATION_ERROR",
          "UNAUTHORIZED",
          "FORBIDDEN",
          "NOT_FOUND",
          "METHOD_NOT_ALLOWED",
          "CONFLICT",
          "PAYLOAD_TOO_LARGE",
          "RATE_LIMITED",
          "INTERNAL_ERROR",
          "SERVICE_UNAVAILABLE",
        ],
      },
      Error: errorSchema,
      PageMeta: {
        type: "object",
        description: "Cursor pagination. Pass `nextCursor` back as `cursor` for the next page.",
        properties: {
          nextCursor: { type: ["string", "null"] },
          hasMore: { type: "boolean" },
          limit: { type: "integer" },
          total: { type: "integer" },
        },
      },
    },
    responses: {
      ValidationError: errorResponse("The request failed validation. `error.details` maps field paths to messages."),
      Unauthorized: errorResponse("No credentials, or an expired access token. Refresh and retry."),
      Forbidden: errorResponse("Authenticated, but lacking the permission or branch access this endpoint requires."),
      NotFound: errorResponse("No such resource."),
      Conflict: errorResponse("The action conflicts with the current state of the resource."),
      RateLimited: errorResponse("Quota exhausted. `Retry-After` gives the wait in seconds.", {
        "Retry-After": { description: "Seconds to wait before retrying.", schema: { type: "integer" } },
        "RateLimit-Limit": { description: "Requests allowed in the window.", schema: { type: "integer" } },
        "RateLimit-Remaining": { description: "Requests left in the window.", schema: { type: "integer" } },
        "RateLimit-Reset": { description: "Seconds until the window resets.", schema: { type: "integer" } },
        "x-request-id": requestId,
      }),
      ServerError: errorResponse(
        "Unexpected fault. `error.details.requestId` identifies it in the server logs.",
        { "x-request-id": requestId },
      ),
    },
  };
}

const stats = await build();

console.log(`openapi: ${stats.operationCount} operations across ${stats.pathCount} paths (${stats.fileCount} route files)`);
console.log(`written to ${path.relative(ROOT, OUT_FILE)}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
