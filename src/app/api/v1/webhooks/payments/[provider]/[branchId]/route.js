import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { handleWebhook } from "@/server/services/payment-webhook.service";

/**
 * The gateway callback endpoint, scoped to one restaurant.
 *
 * Unauthenticated by necessity — a gateway has no session — so the **signature
 * is the authentication**, verified over the raw request bytes before anything
 * is parsed, looked up or stored.
 *
 * ## Why the branch is in the URL
 *
 * Every restaurant holds its own merchant account, so a callback can only be
 * verified against *that* restaurant's signing secret. The merchant's identity
 * is inside the body — but the body cannot be trusted, or even parsed, until
 * the signature has been checked, and the signature cannot be checked without
 * first knowing which secret to use. That circle only breaks by putting the
 * branch somewhere outside the payload.
 *
 * So each restaurant registers its own URL in its own gateway dashboard, and
 * the settings screen shows them the exact string to paste. Naming a branch in
 * the URL discloses nothing: a branch id is not a secret, and knowing one buys
 * an attacker nothing without the signing key.
 *
 * The parameter-free sibling at `../route.js` is kept for gateways configured
 * before this existed; it resolves no per-branch credentials and is the path
 * to retire once every account has been re-registered.
 *
 * It answers 200 for anything durably stored, including events it does not
 * understand or whose handler threw. A non-2xx makes a gateway retry with
 * backoff and eventually disable the endpoint, so a bug in our processing must
 * not become a dead integration — the failure is recorded on the row and
 * replayed deliberately instead. The one exception is a bad signature, which
 * is 401 and stores nothing.
 */
const paramsSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  branchId: z.string().trim().min(1).max(64),
});

export const POST = apiHandler(
  { params: paramsSchema, rateLimit: false },
  async ({ request, params }) => {
    // Read before anything else touches the stream: `apiHandler`'s body parsing
    // would hand the service a re-serialised object, and a signature checked
    // against re-encoded JSON is a check that passes when it should fail.
    const rawBody = await request.text();

    const headers = {};
    for (const [key, value] of request.headers.entries()) headers[key.toLowerCase()] = value;

    return ok(
      await handleWebhook({
        providerName: params.provider,
        branchId: params.branchId,
        rawBody,
        headers,
      }),
    );
  },
);
