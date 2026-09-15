import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { isExpoPushToken } from "@/server/notifications/push";

/**
 * Push device registry.
 *
 * `pushToken` is globally unique because a token identifies a device
 * installation, not a person: when someone logs out and a colleague logs in on
 * the same handset, the token must move to the new user rather than deliver
 * their notifications to the previous one. Registering an existing token
 * therefore reassigns it.
 */
export async function registerDevice({ userId, pushToken, platform, deviceName, appVersion }) {
  if (!isExpoPushToken(pushToken)) {
    throw ApiError.validation("That does not look like an Expo push token", {
      pushToken: ["Expected ExponentPushToken[...]"],
    });
  }

  const device = await prisma.userDevice.upsert({
    where: { pushToken },
    create: { userId, pushToken, platform, deviceName, appVersion, isActive: true, lastSeenAt: new Date() },
    update: { userId, platform, deviceName, appVersion, isActive: true, lastSeenAt: new Date() },
    select: {
      id: true,
      platform: true,
      deviceName: true,
      appVersion: true,
      isActive: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  return device;
}

export async function listDevices({ userId }) {
  return prisma.userDevice.findMany({
    where: { userId, isActive: true },
    orderBy: { lastSeenAt: "desc" },
    // The token itself is never returned: it is a delivery credential.
    select: { id: true, platform: true, deviceName: true, appVersion: true, lastSeenAt: true, createdAt: true },
  });
}

export async function removeDevice({ userId, id }) {
  const { count } = await prisma.userDevice.updateMany({
    where: { id, userId },
    data: { isActive: false },
  });
  if (!count) throw ApiError.notFound("Device not found");
  return { removed: true };
}
