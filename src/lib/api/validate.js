import { ApiError } from "@/lib/api/errors";

/**
 * Zod parsing with a single, uniform error shape.
 *
 * `details` maps field path -> messages ({ "email": ["Enter a valid email"] }),
 * which both clients render directly against their form fields.
 */
export function fieldErrors(zodError) {
  return zodError.issues.reduce((acc, issue) => {
    const path = issue.path.join(".") || "_";
    (acc[path] ??= []).push(issue.message);
    return acc;
  }, {});
}

export function parse(schema, value, { message = "Invalid input" } = {}) {
  const result = schema.safeParse(value);
  if (!result.success) throw ApiError.validation(message, fieldErrors(result.error));
  return result.data;
}

/** Guards against a client streaming an unbounded body at us. 1 MB by default. */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export async function readJsonBody(request, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw ApiError.tooLarge();

  let text;
  try {
    text = await request.text();
  } catch {
    throw ApiError.validation("Could not read the request body");
  }

  if (text.length > maxBytes) throw ApiError.tooLarge();

  // Endpoints such as refresh and logout are called with no body by the
  // website, which relies on cookies instead — treat that as an empty object.
  if (text.trim() === "") return {};

  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.validation("Request body must be valid JSON");
  }
}

export async function parseBody(request, schema, options) {
  return parse(schema, await readJsonBody(request, options), { message: "Invalid request body" });
}

export function parseQuery(request, schema) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return parse(schema, params, { message: "Invalid query parameters" });
}

/** Route params are a promise in Next 16, hence the await. */
export async function parseParams(context, schema) {
  const params = (await context?.params) ?? {};
  return parse(schema, params, { message: "Invalid route parameters" });
}

/** Multipart uploads (creator videos, receipts, proof-of-delivery photos). */
export async function parseFormData(request, schema) {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw ApiError.validation("Request body must be valid form data");
  }

  const raw = {};
  for (const [key, value] of form.entries()) {
    if (raw[key] === undefined) raw[key] = value;
    else if (Array.isArray(raw[key])) raw[key].push(value);
    else raw[key] = [raw[key], value];
  }

  return parse(schema, raw, { message: "Invalid form data" });
}
