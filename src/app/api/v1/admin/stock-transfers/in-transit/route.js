import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { inTransit } from "@/server/services/stock-transfer.service";

const querySchema = z.object({ branchId: cuidSchema.optional() });

/** What has left but not arrived. */
export const GET = apiHandler(
  { auth: true, permissions: "stock_transfers.read", query: querySchema, branch: "query" },
  async ({ query }) => ok(await inTransit(query)),
);
