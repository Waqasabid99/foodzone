"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";
import { chipClass, isUnread, notificationTone } from "@/lib/account";
import { dateLabel, timeLabel } from "@/lib/finance";

/**
 * Messages the restaurant has sent this person.
 *
 * "Mark all read" sends no ids, which the API reads as "everything" — so it
 * clears messages that arrived while the page was open and are not on screen.
 * That is the behaviour somebody wants from that button, but it is worth
 * knowing it is doing more than clearing what they can see.
 */
export default function NotificationList({ notifications, timeZone = "UTC" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const unread = notifications.filter(isUnread);

  async function act(label, call) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await call();
      if (label) toast.success(label);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {unread.length ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => act("All caught up.", () => api.post("/me/notifications/read", {}))}
          className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Mark all {unread.length} as read
        </button>
      ) : null}

      <ul className="flex flex-col gap-3">
        {notifications.map((notification) => {
          const fresh = isUnread(notification);
          return (
            <li
              key={notification.id}
              className={`flex flex-wrap items-start justify-between gap-3 rounded-card p-5 ${fresh ? "bg-surface-container-low" : "bg-surface-container-lowest"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-label-bold text-on-surface">{notification.title}</span>
                  {fresh ? (
                    <span className={`rounded-full px-2.5 py-1 text-label-bold ${chipClass(notificationTone(notification))}`}>
                      New
                    </span>
                  ) : null}
                </p>
                {notification.body ? (
                  <p className="mt-1 text-body-md text-on-surface-variant">{notification.body}</p>
                ) : null}
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {dateLabel(notification.createdAt, timeZone)} at {timeLabel(notification.createdAt, timeZone)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {fresh ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(null, () => api.post("/me/notifications/read", { ids: [notification.id] }))}
                    className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60"
                  >
                    Mark read
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act("Removed.", () => api.delete(`/me/notifications/${notification.id}`))}
                  className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
