import { apiHandler, ok } from "@/lib/api";
import { z } from "zod";
import { accountTree } from "@/server/services/account.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "accounts.read", query: querySchema },
  async ({ query }) => ok(await accountTree(query)),
);
