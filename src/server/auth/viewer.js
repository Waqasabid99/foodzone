import { readAccessToken, verifyAccessToken } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Who is looking at this page, as far as a Server Component can cheaply tell.
 *
 * This reads the access-token cookie and verifies its signature. It does not
 * touch the database and it does not refresh: the point is to answer "is there
 * a live session on this request?" for things like keeping a signed-in visitor
 * off the login page, not to authorise anything. Every decision that actually
 * matters is made by the API, where the token is checked against the user's
 * `tokensValidFrom` and their permissions are resolved.
 *
 * The conservative direction is deliberate. An access token lives 15 minutes
 * while the session lives 30 days, so someone with a valid session but a stale
 * access token reads as a guest here and is shown the login form — mildly
 * redundant. The opposite mistake, treating a revoked session as live, would
 * be the one worth avoiding.
 */
export async function getViewer() {
  const token = await readAccessToken();
  if (!token) return null;

  const payload = verifyAccessToken(token);
  if (!payload) return null;

  return { userId: payload.userId, sessionId: payload.sessionId };
}

/** True when this request carries a live access token. */
export async function isSignedIn() {
  return (await getViewer()) !== null;
}

/**
 * The session user's own name and address, for pages that greet them or have
 * to show which inbox a code went to.
 *
 * A narrow read rather than `getUser()` from the user service: that one is the
 * admin view of an account and pulls roles, branch scopes and override rows
 * with it. This is the account looking at its own page, so it selects the four
 * columns the page renders and nothing else.
 *
 * Returns null whenever `getViewer()` does, and also for a deleted account
 * whose token has not expired yet.
 */
export async function getViewerAccount() {
  const viewer = await getViewer();
  if (!viewer) return null;

  const user = await prisma.user.findFirst({
    where: { id: viewer.userId, deletedAt: null },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (!user) return null;

  return {
    ...viewer,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}
