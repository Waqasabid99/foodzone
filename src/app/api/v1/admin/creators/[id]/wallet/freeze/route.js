import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { freezeWalletSchema } from "@/server/validation/creator.schemas";
import { setWalletFrozen } from "@/server/services/creator-wallet.service";

/** A frozen wallet can still receive credit; it just cannot be spent. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "creator_wallets.freeze",
    params: idParamSchema,
    body: freezeWalletSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await setWalletFrozen({ creatorId: params.id, ...body, actor: auth })),
);
