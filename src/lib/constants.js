// Formats a Date (or date string) as "Jan 5, 2026".
export function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Formats a Date (or date string) as "2:45 PM".
export function formatTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Formats a Date (or date string) as "Jan 5, 2026, 2:45 PM".
export function formatDateTime(date) {
  return `${formatDate(date)}, ${formatTime(date)}`;
}
