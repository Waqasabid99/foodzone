import { apiHandler, branchScope, ok } from "@/lib/api";
import { listCreatorsSchema } from "@/server/validation/creator.schemas";
import { listCreators } from "@/server/services/creator.service";

export const GET = apiHandler(
  { auth: true, permissions: "creators.read", query: listCreatorsSchema },
  async ({ auth, query }) => ok(await listCreators({ ...query, scope: branchScope(auth, "creators.read") })),
);
