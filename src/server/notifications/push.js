import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Expo push.
 *
 * The app is built with Expo, so this is one HTTPS call to Expo's service —
 * no APNs certificates or FCM service accounts to manage. Device tokens are
 * collected whether or not sending is enabled, so turning `EXPO_PUSH_ENABLED`
 * on later needs no migration and no client change.
 *
 * Expo replies per message. A `DeviceNotRegistered` error means the app was
 * uninstalled or the token rotated: that device is deactivated rather than
 * retried, because retrying it will never succeed.
 */
const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

export function isPushEnabled() {
  return env().EXPO_PUSH_ENABLED;
}

/** Expo tokens look like ExponentPushToken[xxxx] or ExpoPushToken[xxxx]. */
export function isExpoPushToken(token) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(token ?? ""));
}

export async function sendPushToUser({ userId, title, body, data }) {
  const devices = await prisma.userDevice.findMany({
    where: { userId, isActive: true },
    select: { id: true, pushToken: true },
  });

  if (!devices.length) return { sent: 0, skipped: "NO_DEVICES" };
  return sendPush({ devices, title, body, data });
}

export async function sendPush({ devices, title, body, data }) {
  if (!isPushEnabled()) {
    logger.debug("push disabled, not sending", { devices: devices.length, title });
    return { sent: 0, skipped: "DISABLED" };
  }

  const valid = devices.filter((device) => isExpoPushToken(device.pushToken));
  if (!valid.length) return { sent: 0, skipped: "NO_VALID_TOKENS" };

  let sent = 0;
  const deactivate = [];

  for (let index = 0; index < valid.length; index += BATCH_SIZE) {
    const batch = valid.slice(index, index + BATCH_SIZE);

    const response = await fetch(EXPO_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(env().EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env().EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(
        batch.map((device) => ({
          to: device.pushToken,
          title,
          body,
          data: data ?? {},
          sound: "default",
        })),
      ),
    });

    if (!response.ok) {
      // Throwing lets the outbox retry with backoff: a 5xx from Expo is
      // transient, and dropping the notification would be the wrong response.
      throw new Error(`Expo push failed with ${response.status}`);
    }

    const payload = await response.json();
    const tickets = Array.isArray(payload?.data) ? payload.data : [];

    tickets.forEach((ticket, position) => {
      if (ticket?.status === "ok") {
        sent += 1;
        return;
      }
      if (ticket?.details?.error === "DeviceNotRegistered") deactivate.push(batch[position].id);
      else logger.warn("push ticket rejected", { error: ticket?.details?.error, message: ticket?.message });
    });
  }

  if (deactivate.length) {
    await prisma.userDevice.updateMany({ where: { id: { in: deactivate } }, data: { isActive: false } });
    logger.info("deactivated unregistered devices", { count: deactivate.length });
  }

  return { sent, deactivated: deactivate.length };
}
