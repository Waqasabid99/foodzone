"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { lastSeen } from "@/lib/customer-form";
import Chip from "@/components/dashboard/inventory/Chip";

/**
 * Your own messages. Marking one read is immediate rather than on hover: a
 * notification that clears itself as the cursor passes is how people miss
 * things.
 */
export default function NotificationInbox({ notifications, unread }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function markRead(ids = null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/me/notifications/read", ids ? { ids } : {});
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-label-bold text-error">{error}</p> : null}

      {unread > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-md text-on-surface">{unread} unread</p>
          <button type="button" onClick={() => markRead(null)} disabled={busy} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60">
            {busy ? "Marking…" : "Mark all as read"}
          </button>
        </div>
      ) : null}

      {notifications.length ? (
        <ul className="flex flex-col gap-2">
          {notifications.map((notification) => (
            <li key={notification.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-field px-4 py-3 ${notification.readAt ? "bg-surface-container-low" : "bg-secondary-container text-on-secondary-container"}`}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-label-bold">{notification.title}</span>
                  {notification.readAt ? null : <Chip tone="bg-surface-container-lowest text-on-surface">New</Chip>}
                </p>
                {notification.body ? <p className="mt-0.5 text-body-md">{notification.body}</p> : null}
                <p className="text-body-md opacity-80">{lastSeen(notification.createdAt)}</p>
              </div>
              {notification.readAt ? null : (
                <button type="button" onClick={() => markRead([notification.id])} disabled={busy} className="rounded-field px-3 py-2 text-label-bold underline disabled:opacity-60">
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-10 text-center text-body-md text-on-surface-variant">
          Nothing here. Messages about orders, stock and your shifts arrive as they happen.
        </p>
      )}
    </div>
  );
}
