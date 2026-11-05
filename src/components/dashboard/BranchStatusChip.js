import { CalendarOff, CircleCheck, CircleSlash, Clock, HelpCircle } from "lucide-react";

/**
 * Whether a branch is serving right now, and why not when it isn't.
 *
 * "Closed" on its own sends a manager hunting: closed because the week's hours
 * say so, because someone declared a one-off closure, or because nobody ever
 * set hours at all are three different problems with three different fixes. The
 * reason is the useful part, so it is the label.
 *
 * Colour never carries the meaning alone — each state ships with its own icon
 * and its own words, which is what keeps it readable in greyscale, to a
 * colourblind reader, and in a screenshot pasted into a group chat.
 */
const STATES = {
  OPEN: { label: "Open now", icon: CircleCheck, tone: "bg-success-container text-on-success-container" },
  OUTSIDE_HOURS: { label: "Closed now", icon: Clock, tone: "bg-surface-container-high text-on-surface-variant" },
  CLOSURE: { label: "Closed — one-off", icon: CalendarOff, tone: "bg-warning-container text-on-warning-container" },
  INACTIVE: { label: "Not trading", icon: CircleSlash, tone: "bg-surface-container-high text-on-surface-variant" },
  NO_HOURS_SET: { label: "No hours set", icon: HelpCircle, tone: "bg-warning-container text-on-warning-container" },
};

export default function BranchStatusChip({ openState }) {
  const state = STATES[openState?.reason] ?? STATES.NO_HOURS_SET;
  const Icon = state.icon;

  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {state.label}
    </span>
  );
}
