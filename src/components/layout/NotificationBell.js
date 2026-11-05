"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell, BellOff, Check } from "lucide-react";
import { loadNotifications, markAllRead, useNotifications } from "@/hooks/useNotifications";
import { isMuted, serverMuted, setMuted, subscribeMute } from "@/lib/chime";

/**
 * New mail, in the header.
 *
 * A notification that only exists on its own page is one nobody reads: the
 * point of an inbox is being told without going to look. The badge says how
 * many, the panel says what they are, and a chime says one just arrived while
 * somebody was looking at something else.
 *
 * `href` differs by where this sits — staff have a workspace inbox, customers
 * an account one — so the component takes it rather than guessing from the
 * current path.
 */
export default function NotificationBell({ href = "/account/notifications" }) {
  const { status, unread, items, listStatus } = useNotifications();
  const boxRef = useRef(null);
  const [open, setOpen] = useState(false);
  // Read as an external store rather than copied into state: browser storage
  // does not exist on the server, and the first render has to match what the
  // server sent.
  const muted = useSyncExternalStore(subscribeMute, isMuted, serverMuted);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // The list is fetched when it is going to be looked at, not on every poll:
    // the badge only ever needed a count.
    if (next) loadNotifications();
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-10 place-items-center rounded-full text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Bell aria-hidden="true" className="size-5" />

        {/* Nothing until the first count lands: a zero that becomes a three a
            moment later says "no mail" to somebody who has some. */}
        {status === "ready" && unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-label-bold text-[0.6875rem] leading-5 text-on-primary"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-card bg-surface-container-lowest shadow-e3"
        >
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
            <h2 className="font-display text-label-bold uppercase text-on-surface">Notifications</h2>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMuted(!muted)}
                aria-pressed={muted}
                aria-label={muted ? "Turn the notification sound on" : "Turn the notification sound off"}
                className="grid size-9 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {muted ? <BellOff aria-hidden="true" className="size-4" /> : <Bell aria-hidden="true" className="size-4" />}
              </button>

              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="inline-flex items-center gap-1 rounded-field px-3 py-1.5 text-label-bold text-primary hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Check aria-hidden="true" className="size-4" />
                  Mark all read
                </button>
              ) : null}
            </div>
          </div>

          {listStatus === "loading" && items.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">Nothing new.</p>
          ) : (
            <ul className="flex max-h-96 flex-col divide-y divide-outline-variant overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  // Unread is marked by weight and a dot, never by colour
                  // alone — that is the one difference somebody has to see.
                  className={`flex gap-3 px-4 py-3 ${item.readAt ? "" : "bg-surface-container-low"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-primary"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-label-bold ${item.readAt ? "text-on-surface-variant" : "text-on-surface"}`}>
                      {item.title}
                      {item.readAt ? null : <span className="sr-only"> (unread)</span>}
                    </span>
                    {item.body ? (
                      <span className="mt-0.5 block text-body-md text-on-surface-variant">{item.body}</span>
                    ) : null}
                    <span className="mt-1 block text-label-bold font-normal text-on-surface-variant">
                      {when(item.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            href={href}
            onClick={() => setOpen(false)}
            className="block border-t border-outline-variant px-4 py-3 text-center text-label-bold text-primary hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            See everything
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/**
 * How long ago, in words.
 *
 * Relative rather than a timestamp: "4 minutes ago" is what somebody wants
 * from an inbox, and a notification older than a week is better dated than
 * counted in days.
 */
function when(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return at.toLocaleDateString();
}
