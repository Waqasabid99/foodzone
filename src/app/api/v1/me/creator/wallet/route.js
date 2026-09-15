import { apiHandler, ok } from "@/lib/api";
import { statementQuerySchema } from "@/server/validation/creator.schemas";
import { creatorForUser } from "@/server/services/creator.service";
import { walletStatement } from "@/server/services/creator-wallet.service";

export const GET = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard", query: statementQuerySchema },
  async ({ query, auth }) => {
    const creator = await creatorForUser(auth.userId);
    return ok(await walletStatement({ creatorId: creator.id, ...query }));
  },
);
