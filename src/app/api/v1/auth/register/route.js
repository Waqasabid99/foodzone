import { apiHandler, created, setSessionCookies, RateLimits } from "@/lib/api";
import { registerSchema } from "@/server/validation/schemas";
import { register } from "@/server/services/auth.service";
import { claimGuestCart } from "@/server/services/cart.service";
import { logger } from "@/lib/logger";

export const POST = apiHandler(
  { body: registerSchema, rateLimit: RateLimits.auth, scope: "auth:register" },
  async ({ body, ipAddress, userAgent, client, sessionId }) => {
    const session = await register({ ...body, client, ipAddress, userAgent });

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

    // Cookies for the browser; the same tokens are in the body for the app.
    return setSessionCookies(created(session), session);
  },
);
