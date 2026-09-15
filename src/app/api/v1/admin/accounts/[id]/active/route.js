import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setAccountActiveSchema } from "@/server/validation/finance.schemas";
import { setAccountActive } from "@/server/services/account.service";

/** Deactivation, never deletion — a posted line points at this account for ever. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "accounts.deactivate",
    params: idParamSchema,
    body: setAccountActiveSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await setAccountActive(params.id, body.isActive, auth)),
);
