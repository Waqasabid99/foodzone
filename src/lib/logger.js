/**
 * Structured logging.
 *
 * One JSON object per line so a log aggregator can filter on `requestId`,
 * `userId` or `status` without parsing prose. In development it prints a
 * compact human-readable line instead.
 */
import { isProduction } from "@/lib/env";

const REDACTED = "[redacted]";
const SENSITIVE = /^(password|passwordHash|token|accessToken|refreshToken|tokenHash|secret|authorization|apiKey|otp|signature|cardNumber|cvv)$/i;

/** Recursively masks credentials so a debug log never becomes a breach. */
export function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

function emit(level, message, fields = {}) {
  const payload = { level, message, time: new Date().toISOString(), ...redact(fields) };

  if (isProduction()) {
    console[level === "debug" ? "log" : level](JSON.stringify(payload));
    return;
  }

  const context = Object.entries(payload)
    .filter(([key]) => !["level", "message", "time"].includes(key))
    .map(([key, item]) => {
      const value = typeof item === "object" ? JSON.stringify(item) : String(item);
      // Collapse newlines: one log entry must stay one line, or every log
      // reader and `grep` downstream sees a fragment as its own record.
      return `${key}=${value.replace(/\s*\n\s*/g, " | ")}`;
    })
    .join(" ");

  console[level === "debug" ? "log" : level](`[${level}] ${message}${context ? ` ${context}` : ""}`);
}

export const logger = {
  debug: (message, fields) => (isProduction() ? undefined : emit("debug", message, fields)),
  info: (message, fields) => emit("info", message, fields),
  warn: (message, fields) => emit("warn", message, fields),
  error: (message, fields) => emit("error", message, fields),
};
