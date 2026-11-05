/**
 * Whether the background queue is actually running.
 *
 * Every consequence of an order happens out of band: stock comes off the
 * shelf, revenue and cost reach the ledger, the customer is told their order
 * was received, a delivery job is created. All of it rides on the outbox, and
 * all of it is invisible when the queue stops — the orders still go through,
 * the money is still taken, and nothing downstream of them ever happens.
 *
 * That is exactly what had happened here: the worker was switched off, no
 * scheduler was calling the drain endpoint, and twenty events sat pending for
 * days. Nothing said so. `outboxStats()` had been written for "a status
 * endpoint or an alert" and no screen had ever read it.
 *
 * So the test is **age, not depth**. A queue with fifty events in it that are
 * seconds old is a busy queue; a queue with one event in it that is an hour
 * old is a stopped one. Counting alone cannot tell those apart, which is why a
 * backlog number on its own would not have caught this.
 */

/**
 * How long a pending event may sit before the queue is considered stopped.
 *
 * Generous against the default twenty-second worker interval: a slow batch, a
 * redeploy or a scheduler that fires once a minute must not raise an alarm, or
 * the alarm is one people learn to ignore.
 */
export const STALL_AFTER_MINUTES = 5;

const MINUTE = 60 * 1000;

/** Whole minutes, rounded down, floored at zero. */
export function minutesSince(at, now = new Date()) {
  if (!at) return 0;
  const started = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(started.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - started.getTime()) / MINUTE));
}

/** "3 minutes", "2 hours", "4 days" — the longest unit that is still true. */
export function ageLabel(minutes) {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The verdict, in the words somebody reading it would use.
 *
 * Three states rather than a number, because the question is not "how many"
 * but "do I need to do something":
 *
 *   * `ok` — nothing to say, and nothing is shown.
 *   * `stalled` — the queue has stopped. Everything downstream of every order
 *     is silently not happening, which is the serious one.
 *   * `failing` — the queue is running but some events have given up after
 *     their last retry. Narrower: those specific events need looking at.
 *
 * A stall outranks failures, because a stopped queue is why the failures
 * stopped being retried.
 */
export function queueHealth({ pending = 0, failed = 0, oldestPendingAt = null, topFailure = null, now = new Date() } = {}) {
  const waiting = minutesSince(oldestPendingAt, now);
  const stalled = pending > 0 && waiting >= STALL_AFTER_MINUTES;

  if (stalled) {
    return {
      level: "stalled",
      pending,
      failed,
      waitingMinutes: waiting,
      title: "Background work has stopped",
      body:
        `Nothing has been processed for ${ageLabel(waiting)}, and ${pending} ${pending === 1 ? "event is" : "events are"} waiting. ` +
        "Until it runs again, sales are not reaching the ledger, stock is not coming off the shelf and no notification is being sent. " +
        "Orders and payments themselves are unaffected.",
    };
  }

  if (failed > 0) {
    // The reason, verbatim, when there is one. These messages are written for
    // the person who can fix them and usually name the fix outright, so
    // paraphrasing them into "an error occurred" would throw away the only
    // useful part.
    const because = topFailure?.reason ? ` Most of them said: “${topFailure.reason}”.` : "";

    return {
      level: "failing",
      pending,
      failed,
      waitingMinutes: waiting,
      reason: topFailure?.reason ?? null,
      title: `${failed} ${failed === 1 ? "piece" : "pieces"} of background work gave up`,
      body:
        "The queue is running, but these have been retried as often as they will be and stopped. " +
        "Whatever they were going to do — post to the ledger, deduct stock, send a notification — has not happened." +
        because,
    };
  }

  return { level: "ok", pending, failed, waitingMinutes: waiting, reason: null, title: null, body: null };
}
