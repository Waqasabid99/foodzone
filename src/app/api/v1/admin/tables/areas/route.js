import { apiHandler, ok } from "@/lib/api";
import { areaQuerySchema } from "@/server/validation/dinein.schemas";
import { listAreas } from "@/server/services/table.service";

/** The distinct areas in use at a branch — what a filter dropdown needs. */
export const GET = apiHandler(
  { auth: true, permissions: "tables.read", query: areaQuerySchema, branch: "query" },
  async ({ query }) => ok(await listAreas(query.branchId)),
);
