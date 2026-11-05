import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";

/**
 * Who is signed in, and what they may see — resolved on the server.
 *
 * Deliberately not the browser-side `useSession`. The storefront reads the
 * session in the browser to keep the home page static, and pays for it with a
 * frame where nobody is identified yet. A workspace cannot make that trade: the
 * sidebar *is* the page, and rendering an empty one that fills in a moment
 * later would flash an empty sidebar at every person who opens it. These routes are
 * authenticated and therefore dynamic regardless, so there is no static
 * rendering left to protect.
 *
 * Permissions are resolved per request from the database rather than read off
 * the token, which is what makes a revoked role take effect on the next page
 * load instead of whenever the token happens to expire.
 */
export async function getWorkspaceViewer() {
  const principal = await getAuthContext();
  if (!principal) return null;

  return {
    id: principal.userId,
    name: principal.name,
    email: principal.email,
    emailVerified: Boolean(principal.emailVerified),
    homePage: principal.homePage ?? null,
    // Set while an administrator's temporary password is still in force: the
    // workspace holds them to choosing their own before anything else.
    mustChangePassword: Boolean(principal.mustChangePassword),
    // `["*"]` for a super admin: they hold everything by bypass rather than by
    // grant, so there is no list to enumerate.
    permissions: grantedPermissionKeys(principal),
    roles: principal.roles.map((role) => ({ key: role.key, name: role.name, branchId: role.branchId ?? null })),
    /** The most senior role, which is the one worth showing under their name. */
    roleLabel: principal.isSuperAdmin
      ? "Super Admin"
      : ([...principal.roles].sort((a, b) => (a.level ?? 99) - (b.level ?? 99))[0]?.name ?? null),
  };
}
