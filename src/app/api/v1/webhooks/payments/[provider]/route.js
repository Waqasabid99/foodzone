import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { handleWebhook } from "@/server/services/payment-webhook.service";

/**
 * The gateway callback endpoint.
 *
 * Unauthenticated by necessity — a gateway has no session — so the **signature
 * is the authentication**, verified over the raw request bytes before anything
 * is parsed, looked up or stored.
 *
 * Note what this handler deliberately does *not* do: it declares no `body`
 * schema. `apiHandler`'s parsing would consume the request stream and hand the
 * service a re-serialised object, and a signature checked against re-encoded
 * JSON is a check that passes when it should fail. So the raw text is read here
 * and passed through untouched.
 *
 * It answers 200 for anything durably stored, including events it does not
 * understand or whose handler threw. A non-2xx makes a gateway retry with
 * backoff and eventually disable the endpoint, so a bug in our processing must
 * not become a dead integration — the failure is recorded on the row and
 * replayed deliberately instead. The one exception is a bad signature, which is
 * 401 and stores nothing.
 */
const paramsSchema = z.object({ provider: z.string().trim().min(2).max(40) });

export const POST = apiHandler(
  { params: paramsSchema, rateLimit: false },
  async ({ request, params }) => {
    const rawBody = await request.text();

    const headers = {};
    for (const [key, value] of request.headers.entries()) headers[key.toLowerCase()] = value;

    return ok(await handleWebhook({ providerName: params.provider, rawBody, headers }));
  },
);
