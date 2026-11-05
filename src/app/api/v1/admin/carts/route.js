import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { listCartsSchema } from "@/server/validation/cart-admin.schemas";
import { listCarts } from "@/server/services/cart-admin.service";

/**
 * Who is mid-order right now.
 *
 * Support tooling: somebody rings to say they cannot check out, and this is
 * how the person answering sees what they are looking at. Read-only by
 * design — staff do not reach into a shopper's basket while they are using it.
 */
export const GET = apiHandler(
  { auth: true, permissions: "carts.read", query: listCartsSchema, branch: "query" },
  async ({ query, auth }) => ok(await listCarts({ ...query, scope: branchScope(auth, "carts.read") })),
);
