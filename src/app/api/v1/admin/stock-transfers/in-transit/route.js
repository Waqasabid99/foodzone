import { z } from "zod";
import { apiHandler, branchScope, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { inTransit } from "@/server/services/stock-transfer.service";

const querySchema = z.object({ branchId: cuidSchema.optional() });

/** What has left but not arrived. */
export const GET = apiHandler(
  { auth: true, permissions: "stock_transfers.read", query: querySchema, branch: "query" },
  async ({ query, auth }) => ok(await inTransit({ ...query, scope: branchScope(auth, "stock_transfers.read") })),
);
