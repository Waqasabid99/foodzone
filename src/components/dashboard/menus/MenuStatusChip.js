import { CalendarClock, CalendarX, CircleCheck, CircleSlash, Clock, EyeOff } from "lucide-react";

/**
 * Whether customers are seeing a menu right now, and why not.
 *
 * "Not showing" has five causes with five different fixes — it is switched
 * off, its dates have passed or not arrived, it is outside its hours, or
 * another menu outranks it — so the cause is the label. Each state has its own
 * icon and words, never colour alone.
 */
const STATES = {
  LIVE: { icon: CircleCheck, tone: "bg-success-container text-on-success-container" },
  OUTRANKED: { icon: EyeOff, tone: "bg-warning-container text-on-warning-container" },
  OUT_OF_HOURS: { icon: Clock, tone: "bg-surface-container-high text-on-surface-variant" },
  UPCOMING: { icon: CalendarClock, tone: "bg-surface-container-high text-on-surface-variant" },
  ENDED: { icon: CalendarX, tone: "bg-surface-container-high text-on-surface-variant" },
  OFF: { icon: CircleSlash, tone: "bg-surface-container-high text-on-surface-variant" },
};

export default function MenuStatusChip({ live }) {
  const state = STATES[live.key] ?? STATES.OFF;
  const Icon = state.icon;
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {live.label}
    </span>
  );
}
