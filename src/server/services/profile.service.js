import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { grantedPermissionKeys, invalidatePrincipal } from "@/lib/api/permissions";
import { publicUser } from "@/server/services/auth.service";

/**
 * Self-service profile.
 *
 * Email is deliberately not editable here: changing it would have to re-run
 * verification and invalidate the login identity, so it belongs in its own
 * flow rather than hiding inside a generic profile PATCH.
 */
export async function getProfile(principal) {
  const user = await prisma.user.findFirst({ where: { id: principal.userId, deletedAt: null } });
  if (!user) throw ApiError.unauthorized();

  return publicUser(user, {
    roles: principal.roles,
    permissions: grantedPermissionKeys(principal),
  });
}

export async function updateProfile(principal, { name, phone, locale, avatarUrl }) {
  const user = await prisma.user.findFirst({
    where: { id: principal.userId, deletedAt: null },
    select: { id: true, phone: true },
  });
  if (!user) throw ApiError.unauthorized();

  const phoneChanged = phone !== undefined && phone !== user.phone;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      // A new number is unproven until it is verified, so drop the flag.
      ...(phoneChanged ? { phone: phone || null, phoneVerifiedAt: null } : {}),
      ...(locale !== undefined ? { locale } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    },
  });

  if (name !== undefined) invalidatePrincipal(user.id);
  return getProfile(principal);
}
