"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import {
  ITEM_NEXT,
  ITEM_STATES,
  KITCHEN_POLL_SECONDS,
  ORDER_TYPE_LABELS,
  SET_ASIDE_REASONS,
  itemAction,
  ticketUrgency,
} from "@/lib/service";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { channel } from "@/lib/realtime";

/**
 * The kitchen display.
 *
 * This is the only screen in the system nobody is sitting in front of. It is
 * propped on a shelf, read from several feet away by somebody holding a pan,
 * and touched with the side of a thumb. Everything about it follows from that:
 *
 *   * **It refreshes itself.** A kitchen display that only updates when
 *     somebody taps it is not a kitchen display. It re-asks every few seconds.
 *   * **A failed poll is not an error message.** Kitchen wifi drops. The board
 *     keeps showing the last good tickets and quietly tries again; it only
 *     says something once it has been out of touch long enough that what is on
 *     screen might genuinely be stale.
 *   * **Age is a band, not a number.** Fine, getting on, late — read at a
 *     glance. The thresholds are deliberately generous, because a board that
 *     cries wolf at four minutes is one the kitchen learns to ignore, and then
 *     it is useless at forty.
 *   * **One tap per line, and the tap is optimistic.** The line moves
 *     immediately and rolls back if the server disagrees. Waiting half a
 *     second for a round trip with six orders up is how tickets get
 *     double-tapped.
 */
export default function KitchenBoard({ branchId, stationId = "", stationName = null, initial, canBump, canSetAside = false, liveEnabled = false }) {
  const [tickets, setTickets] = useState(initial?.tickets ?? []);
  const [lastGood, setLastGood] = useState(() => new Date());
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
  const [now, setNow] = useState(() => new Date());
  // Which ticket is being set aside, and anything typed instead of a preset.
  const [asking, setAsking] = useState(null);
  const [typed, setTyped] = useState("");
  const mounted = useRef(true);

  const query = `branchId=${encodeURIComponent(branchId)}${stationId ? `&stationId=${encodeURIComponent(stationId)}` : ""}`;

  const refresh = useCallback(async () => {
    try {
      // The endpoint answers with a bare array of tickets, oldest first.
      const data = await api.get(`/admin/kds?${query}`);
      if (!mounted.current) return;
      setTickets(Array.isArray(data) ? data : (data?.items ?? []));
      setLastGood(new Date());
      setOffline(false);
    } catch {
      // Deliberately silent. The board keeps the last good tickets up; the
      // staleness notice below is what tells the kitchen when to stop
      // trusting them.
      if (mounted.current) setOffline(true);
    }
  }, [query]);

  /*
   * Told when a ticket lands, and asking anyway.
   *
   * The poll is not replaced, it is slowed — and only once the server has said
   * its frames can be trusted on this deployment. A board that stopped asking
   * because a socket was open is a board that shows an empty kitchen while
   * orders pile up, which is the one failure a kitchen display must not have.
   */
  const { live } = useLiveRefresh({
    channels: [channel.branchKds(branchId)],
    refresh,
    fastSeconds: KITCHEN_POLL_SECONDS,
    enabled: liveEnabled,
  });

  useEffect(() => {
    mounted.current = true;
    // A slow tick purely so the age badges keep counting up between fetches —
    // otherwise a ticket sits at "11 min" for a minute and a half at a time.
    const clock = setInterval(() => setNow(new Date()), 15_000);
    return () => {
      mounted.current = false;
      clearInterval(clock);
    };
  }, []);

  const secondsStale = Math.floor((now.getTime() - lastGood.getTime()) / 1000);
  const reallyStale = offline && secondsStale > KITCHEN_POLL_SECONDS * 3;

  async function advance(ticket, item) {
    const next = ITEM_NEXT[item.status];
    if (!next || busy.has(item.id)) return;

    setBusy((current) => new Set(current).add(item.id));
    // Optimistic: the line moves now, and goes back if the server refuses.
    const before = tickets;
    setTickets((current) =>
      current.map((row) =>
        row.ticketId === ticket.ticketId
          ? { ...row, items: row.items.map((line) => (line.id === item.id ? { ...line, status: next } : line)) }
          : row,
      ),
    );

    try {
      await api.put(`/admin/kds/items/${item.id}`, { status: next });
      await refresh();
    } catch (failure) {
      setTickets(before);
      toast.error(failure?.message ?? "That line did not move.");
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(item.id);
        return copy;
      });
    }
  }

  async function bump(ticket) {
    if (busy.has(ticket.ticketId)) return;
    setBusy((current) => new Set(current).add(ticket.ticketId));
    try {
      // Scoped to whatever the board is filtered to, because that is the only
      // thing this button can honestly mean. Unfiltered it sends no station
      // and the whole round goes, which is what "every station" is — but the
      // round is always named, because a ticket on screen is one round of a
      // meal and a button on it must not reach the others.
      await api.post(`/admin/orders/${ticket.id}/bump`, {
        status: "READY",
        ...(stationId ? { stationId } : {}),
        ...(ticket.course ? { course: ticket.course } : {}),
      });
      await refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "The ticket did not bump.");
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(ticket.ticketId);
        return copy;
      });
    }
  }

  /**
   * Takes a stuck ticket off the board.
   *
   * The reason is required, because the next person to see this is at the till
   * deciding whether to cancel somebody's order, and "nobody collected it" and
   * "duplicate ticket" lead to different decisions.
   *
   * Asked for in the ticket rather than in a browser prompt: this is a
   * touchscreen on a wall with greasy fingers on it, and an OS dialog with a
   * text field is the worst possible control there. The four common answers
   * are one tap each and typing is the exception.
   */
  async function setAside(ticketId, reason) {
    if (busy.has(ticketId)) return;

    setBusy((current) => new Set(current).add(ticketId));
    try {
      await api.post(`/admin/orders/${ticketId}/set-aside`, { reason });
      toast.success("Off the board and with the till.");
      setAsking(null);
      setTyped("");
      await refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "It could not be set aside.");
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(ticketId);
        return copy;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-md text-on-surface-variant" aria-live="polite">
          {reallyStale
            ? `Out of touch for ${Math.floor(secondsStale / 60) || "<1"} min — what is on screen may be out of date.`
            : `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"} up · ${live ? "new orders appear as they are placed" : `refreshing every ${KITCHEN_POLL_SECONDS}s`}`}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Refresh now
        </button>
      </div>

      {reallyStale ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          The board cannot reach the server. It is still trying, and the tickets below are the last ones it managed to
          fetch.
        </p>
      ) : null}

      {tickets.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tickets.map((ticket) => {
            // Each round carries its own clock. A table ordering coffee after
            // an hour-long meal must not hand the kitchen an hour-old ticket
            // for two coffees that were ordered a minute ago.
            const urgency = ticketUrgency(ticket.firedAt ?? ticket.placedAt, { now });
            const outstanding = (ticket.items ?? []).filter((line) => line.status !== "SERVED" && line.status !== "CANCELLED");
            return (
              <li key={ticket.ticketId} className={`flex flex-col gap-3 rounded-card border-2 p-4 ${urgency.tone}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-label-bold">{ticket.orderNumber}</p>
                  <p className="font-display text-headline-md tabular-nums">{urgency.minutes}m</p>
                </div>
                <p className="text-body-md">
                  {ORDER_TYPE_LABELS[ticket.type] ?? ticket.type}
                  {ticket.table?.name ? ` · table ${ticket.table.name}` : ""}
                </p>

                {/* Said out loud, because the same table appearing twice on the
                    board is otherwise read as a duplicate and binned. */}
                {ticket.course > 1 ? (
                  <p className="rounded-field bg-surface-container-lowest px-3 py-2 text-label-bold text-on-surface">
                    Round {ticket.course} — ordered just now, on the same bill
                  </p>
                ) : null}

                {/* What the counter typed into "For the kitchen". The board
                    fetched it and never drew it, so an allergy the cashier was
                    told about reached the order screen and stopped there. */}
                {ticket.kitchenNote ? (
                  <p className="rounded-field bg-surface-container-lowest px-3 py-2 text-label-bold font-normal text-error">
                    {ticket.kitchenNote}
                  </p>
                ) : null}

                <ul className="flex flex-col gap-2">
                  {(ticket.items ?? []).map((item) => {
                    const next = ITEM_NEXT[item.status];
                    const state = ITEM_STATES[item.status] ?? { label: item.status, tone: "" };
                    return (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-surface-container-lowest px-3 py-2">
                        <span className="min-w-0 text-body-md text-on-surface">
                          <strong className="tabular-nums">{item.quantity}×</strong> {item.nameSnapshot}
                          {/* Modifiers are the part a cook must not miss, so they
                              sit under the line rather than behind a tap. */}
                          {item.modifiers?.length ? (
                            <span className="block text-label-bold font-normal text-on-surface-variant">
                              {item.modifiers.map((mod) => `${mod.quantity > 1 ? `${mod.quantity}× ` : ""}${mod.nameSnapshot}`).join(", ")}
                            </span>
                          ) : null}
                          {item.children?.length ? (
                            <span className="block text-label-bold font-normal text-on-surface-variant">
                              {item.children.map((child) => `${child.quantity}× ${child.nameSnapshot}`).join(", ")}
                            </span>
                          ) : null}
                          {item.notes ? <span className="block text-label-bold font-normal text-error">{item.notes}</span> : null}
                          {/* Where it is made. Only on the unfiltered board —
                              a station looking at its own queue already knows,
                              and repeating it on every line is noise. Without
                              it, "every station" was four lines with nothing
                              to say which of them were yours. */}
                          {!stationId && item.station?.name ? (
                            <span className="block text-label-bold font-normal text-on-surface-variant">
                              {item.station.name}
                            </span>
                          ) : null}
                        </span>
                        {next && canBump ? (
                          <button
                            type="button"
                            onClick={() => advance(ticket, item)}
                            disabled={busy.has(item.id)}
                            className="min-h-11 rounded-field bg-primary-container px-4 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {itemAction(next)}
                          </button>
                        ) : (
                          <span className={`rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>{state.label}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {/* Named after what it covers. On a filtered board it is this
                    station's lines and nothing else, so saying "all" would be
                    describing a different set from the one on screen. */}
                {canBump && outstanding.length ? (
                  <button
                    type="button"
                    onClick={() => bump(ticket)}
                    disabled={busy.has(ticket.ticketId)}
                    className="min-h-11 rounded-field bg-surface-container-highest px-4 text-label-bold text-on-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {busy.has(ticket.ticketId) ? "Bumping…" : stationName ? `${stationName} done` : "All ready"}
                  </button>
                ) : null}

                {/* The safety valve. Quiet and last, because it is the rare
                    one — a walk-out, a duplicate, something nobody can make —
                    and a kitchen should never reach for it by accident. */}
                {canSetAside ? (
                  // Keyed on the round, so opening the panel on a table's
                  // second ticket does not open it on their first as well —
                  // even though what it does is the order, which the wording
                  // below says when there is more than one round up.
                  asking === ticket.ticketId ? (
                    <div className="flex flex-col gap-2 rounded-field bg-surface-container-lowest p-3">
                      <p className="text-label-bold text-on-surface">What is wrong with it?</p>
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        {ticket.course > 1 ? "Every round on this order comes off the board. " : ""}
                        The order stays live. Somebody at the till decides whether to cancel it.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {SET_ASIDE_REASONS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setAside(ticket.id, preset)}
                            disabled={busy.has(ticket.id)}
                            className="min-h-11 rounded-field bg-surface-container-high px-3 text-label-bold text-on-surface disabled:opacity-60 hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        placeholder="Or say what happened"
                        aria-label="Another reason"
                        className="min-h-11 rounded-field bg-surface-container px-3 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAside(ticket.id, typed.trim())}
                          disabled={busy.has(ticket.id) || typed.trim().length < 3}
                          className="min-h-11 rounded-field bg-primary-container px-4 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          Set it aside
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAsking(null);
                            setTyped("");
                          }}
                          className="min-h-11 rounded-field bg-surface-container-high px-4 text-label-bold text-on-surface hover:bg-surface-container-highest"
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAsking(ticket.ticketId);
                        setTyped("");
                      }}
                      className="text-label-bold font-normal text-on-surface-variant underline decoration-dotted underline-offset-4 hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Can&rsquo;t make this — set it aside
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-6 py-14 text-center text-body-md text-on-surface-variant">
          Nothing to cook. New orders appear here on their own.
        </p>
      )}
    </div>
  );
}
