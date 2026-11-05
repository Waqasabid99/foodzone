import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { listSequences } from "@/server/services/numbering.service";

const querySchema = z.object({
  documentType: z.string().trim().max(40).optional(),
  branchId: cuidSchema.optional(),
});

/**
 * Every counter that exists. They create themselves as documents are issued,
 * so there is nothing to add here — only the shape of a number to change.
 */
export const GET = apiHandler(
  { auth: true, permissions: "number_sequences.read", query: querySchema, branch: "query" },
  async ({ query }) => ok(await listSequences(query)),
);
