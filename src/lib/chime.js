"use client";

/**
 * The sound a new notification makes.
 *
 * Synthesised rather than shipped as a file: it is two short notes, and an
 * audio asset would be a network request, a cache entry and a format question
 * (Safari and Firefox disagree) for something a dozen lines of oscillator does
 * exactly.
 *
 * **It can always fail, and failing is fine.** A browser refuses to make noise
 * until the person has interacted with the page, so the first chime of a
 * session may be swallowed — which is the browser protecting them, not a bug
 * to work around. Every call is wrapped: a notification that arrives silently
 * is a small loss, an exception thrown from a polling loop is not.
 */

const MUTE_KEY = "foodzone:notification-sound-muted";

let context = null;
const muteListeners = new Set();

/** Per browser, not per account: it is about this room, not this person. */
export function isMuted() {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    // Private mode, blocked storage: audible is the better default.
    return false;
  }
}

export function setMuted(muted) {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Nothing to do — the preference simply will not survive a reload.
  }
  for (const listener of muteListeners) listener();
}

/**
 * The mute flag as an external store, so a component can read it with
 * `useSyncExternalStore` rather than copying it into state from an effect —
 * which React now refuses, and which would render one frame of the wrong icon
 * anyway.
 */
export function subscribeMute(listener) {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

/** The server has no browser storage, and silent is not a safe guess there. */
export const serverMuted = () => false;

/**
 * Two rising notes, about a fifth apart and a quarter of a second in all.
 *
 * Short on purpose. A counter can take a dozen orders an hour and a long sound
 * is one somebody turns off for good after the third time.
 */
export function playChime() {
  if (isMuted()) return false;

  try {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return false;

    context ??= new Ctor();
    // Created before the first gesture, an audio context starts suspended.
    // Resuming is a promise that rejects when the browser is not ready; it is
    // allowed to, and the next chime will try again.
    context.resume?.().catch(() => {});

    const now = context.currentTime;
    for (const [index, frequency] of [880, 1320].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // A ramp rather than a straight stop: an oscillator cut off at full
      // amplitude clicks.
      const start = now + index * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    }

    return true;
  } catch {
    return false;
  }
}
