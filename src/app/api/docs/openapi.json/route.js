import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { assertDocsEnabled } from "@/server/docs/access";
import spec from "@/generated/openapi.json";

/**
 * The OpenAPI document.
 *
 * Generated from the route options by `npm run docs:api` and committed, so the
 * running server never has to walk its own filesystem to describe itself — and
 * so a change to the API surface shows up as a reviewable diff.
 *
 * `servers` is rewritten to the origin the request arrived on, so "Try it out"
 * in the viewer, and any client generated from this document, targets the
 * deployment it was fetched from rather than localhost.
 */
export const GET = apiHandler({}, async ({ request }) => {
  assertDocsEnabled();

  const origin = new URL(request.url).origin;

  return NextResponse.json(
    { ...spec, servers: [{ url: origin, description: "This deployment" }] },
    { headers: { "cache-control": "public, max-age=60" } },
  );
});
