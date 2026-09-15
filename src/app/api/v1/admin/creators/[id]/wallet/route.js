import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { statementQuerySchema } from "@/server/validation/creator.schemas";
import { walletStatement } from "@/server/services/creator-wallet.service";

export const GET = apiHandler(
  { auth: true, permissions: "creator_wallets.read", params: idParamSchema, query: statementQuerySchema },
  async ({ params, query }) => ok(await walletStatement({ creatorId: params.id, ...query })),
);
