import { apiHandler, ok } from "@/lib/api";
import { providerListQuerySchema } from "@/server/validation/payment-provider.schemas";
import { listBranchProviders } from "@/server/services/payment-provider.service";

/**
 * Every gateway the system knows, with this branch's setup folded in.
 *
 * Unconfigured gateways are included, not hidden: the screen's job is "here is
 * what you could turn on", and a list of only what is already configured has
 * no way to add the first one.
 *
 * It never returns a credential — not even a masked prefix. Each field comes
 * back as `isSet` true or false. A gateway key is short and structured enough
 * that a hint is a real head start, and no dashboard needs to echo one back.
 */
export const GET = apiHandler(
  { auth: true, permissions: "payment_providers.read", query: providerListQuerySchema, branch: "query" },
  async ({ query }) => ok(await listBranchProviders({ branchId: query.branchId })),
);
