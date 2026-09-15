import { apiHandler, ok, setSessionCookies, RateLimits } from "@/lib/api";
import { loginSchema } from "@/server/validation/schemas";
import { login } from "@/server/services/auth.service";
import { claimGuestCart } from "@/server/services/cart.service";
import { logger } from "@/lib/logger";

export const POST = apiHandler(
  { body: loginSchema, rateLimit: RateLimits.auth, scope: "auth:login" },
  async ({ body, ipAddress, userAgent, client, sessionId }) => {
    const session = await login({ ...body, client, ipAddress, userAgent });

    // A guest who filled a basket and then signed in keeps it. Failures are
    // swallowed on purpose: losing a cart merge must never cost someone their
    // login, and the cart is recoverable, the session is not.
    if (sessionId && session?.user?.id) {
      try {
        await claimGuestCart({ userId: session.user.id, sessionId });
      } catch (error) {
        logger.warn("could not claim guest cart", { error: error.message });
      }
    }

    return setSessionCookies(ok(session), session);
  },
);
