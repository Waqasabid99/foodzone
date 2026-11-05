"use client";

import { useSession } from "@/hooks/useSession";
import NotificationBell from "@/components/layout/NotificationBell";

/**
 * The bell, for signed-in visitors only.
 *
 * A guest has no inbox, and rendering a bell that always says nothing is a
 * control that teaches people to ignore it. The session is resolved in the
 * browser, so nothing is drawn until the answer is in — holding no space,
 * because unlike the account controls beside it this one legitimately does not
 * exist for most visitors.
 */
export default function HeaderNotifications() {
  /*
   * Keyed on the user, not on a status string. The store's signed-in state is
   * `authenticated`; guarding on a status of "ready" — which this hook never
   * reports — hid the bell from everybody, including while it looked correct
   * in review.
   */
  const { user } = useSession();
  if (!user) return null;

  return <NotificationBell href="/account/notifications" />;
}
