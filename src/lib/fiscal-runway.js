/**
 * Whether anybody needs to be told about the fiscal calendar, and in what
 * words.
 *
 * Pure, and separate from the component, for the same reason `queue-health` is:
 * the judgement of what to say is the part worth testing, and a component that
 * also decides is a component you have to render to find out what it decided.
 *
 * Four levels, because the question is not "how many days" but "is this mine
 * to do something about":
 *
 *   * `ok`       — nothing shown.
 *   * `waiting`  — the calendar covers today, but postings are parked for
 *     dates it does not cover. Narrow, and easy to miss otherwise: those
 *     events are neither failed nor pending, so the queue banner says nothing
 *     about them and the ledger is simply short.
 *   * `expiring` — the year ends soon. A reminder, with the date and the year
 *     to open next, so it can be acted on without going to look anything up.
 *   * `lapsed`   — nothing covers today. The books have stopped: every posting
 *     is being refused and parked. This is the serious one.
 *
 * Lapsed outranks waiting, because a lapsed calendar is why things are waiting.
 */

/** "14 postings are", "1 posting is" — the clause reads either way. */
function postings(count) {
  return `${count} ${count === 1 ? "posting is" : "postings are"}`;
}

export function runwayNotice({
  state = "OK",
  daysLeft = null,
  threshold = null,
  fiscalYear = null,
  calendarEndsAt = null,
  suggestion = null,
  blockedPostings = 0,
} = {}) {
  const waiting = blockedPostings > 0;
  const next = suggestion?.name ?? "the next financial year";

  if (state === "LAPSED") {
    return {
      level: "lapsed",
      serious: true,
      daysLeft,
      threshold,
      blockedPostings,
      title: "The books have no open period for today",
      body:
        "Nothing can be posted to the ledger until a financial year covering today exists. " +
        (waiting
          ? `${postings(blockedPostings)} already waiting and not in the ledger — they will post themselves once the year is open. `
          : "") +
        `Open ${next} on the periods page.`,
    };
  }

  if (state === "EXPIRING") {
    const ends = calendarEndsAt ? new Date(calendarEndsAt).toISOString().slice(0, 10) : null;

    return {
      level: "expiring",
      serious: false,
      daysLeft,
      threshold,
      blockedPostings,
      title: `The financial year ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
      body:
        `${fiscalYear?.name ?? "The current year"}${ends ? ` ends on ${ends}` : " is ending"}. ` +
        `Open ${next} before then, or anything dated after it has nowhere to post. ` +
        "The months are generated for you; the dates and the name are yours to set.",
    };
  }

  if (waiting) {
    return {
      level: "waiting",
      serious: false,
      daysLeft,
      threshold,
      blockedPostings,
      title: `${blockedPostings} ${blockedPostings === 1 ? "posting is" : "postings are"} waiting for an accounting period`,
      body:
        `${postings(blockedPostings)} dated outside every period on the calendar, so ${blockedPostings === 1 ? "it is" : "they are"} ` +
        "being held rather than lost. Open the year covering those dates and they post themselves.",
    };
  }

  return { level: "ok", serious: false, daysLeft, threshold, blockedPostings, title: null, body: null };
}
