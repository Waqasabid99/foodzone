import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { adjustWalletSchema } from "@/server/validation/creator.schemas";
import { adjustWallet } from "@/server/services/creator-wallet.service";

/** Always audited, and always with a reason — this is money. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_wallets.adjust",
    params: idParamSchema,
    body: adjustWalletSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => created(await adjustWallet({ creatorId: params.id, ...body, actor: auth })),
);
