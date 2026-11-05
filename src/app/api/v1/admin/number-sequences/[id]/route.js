import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getSequence, updateSequence } from "@/server/services/numbering.service";

const updateSchema = z
  .object({
    prefix: z.string().trim().max(20).optional(),
    padding: z.coerce.number().int().min(1).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const GET = apiHandler(
  { auth: true, permissions: "number_sequences.read", params: idParamSchema },
  async ({ params }) => ok(await getSequence(params.id)),
);

/**
 * Changes the shape of future numbers. The counter itself is not editable:
 * moving it back re-issues numbers that are already on invoices, and moving it
 * forward leaves a gap an auditor will ask about.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "number_sequences.manage",
    params: idParamSchema,
    body: updateSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateSequence(params.id, body, auth)),
);
