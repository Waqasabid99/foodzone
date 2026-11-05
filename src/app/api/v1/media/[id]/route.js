import { z } from "zod";
import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { attachAssetSchema, idParamSchema } from "@/server/validation/schemas";
import { assetUsage, attachAsset, deleteAsset, getAsset } from "@/server/services/media.service";

/** `usage=1` also answers what is pointing at this file, which is what makes a delete refusable. */
export const GET = apiHandler(
  { auth: true, permissions: "media.upload", params: idParamSchema, query: z.object({ usage: z.stringbool().optional() }) },
  async ({ params, query }) => {
    const asset = await getAsset(params.id);
    return ok(query?.usage ? { ...asset, usedBy: await assetUsage(asset) } : asset);
  },
);

/** Links an uploaded file to the record it belongs to, once that record exists. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "media.upload",
    params: idParamSchema,
    body: attachAssetSchema,
    rateLimit: RateLimits.write,
    audit: { action: "media.attach", entityType: "MediaAsset" },
  },
  async ({ params, body }) => ok(await attachAsset({ id: params.id, ...body })),
);

/**
 * Auth only at the route: the service allows the uploader to delete their own
 * file, and anyone else only with `media.delete`. That ownership-or-permission
 * rule cannot be expressed as a single required key.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "media.delete", entityType: "MediaAsset" },
  },
  async ({ auth, params }) => {
    await deleteAsset({ id: params.id, principal: auth });
    return noContent();
  },
);
