// Event dates are stored as local wall-clock time "YYYY-MM-DDTHH:mm" (no timezone),
// so we parse them by hand instead of going through Date and shifting timezones.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string) {
  const [d, t = "00:00"] = date.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return { y, m, day, h, min };
}

/** { month: "NOV", day: "04" } for the date tile. */
export function dateTile(date: string) {
  const { m, day } = parts(date);
  return { month: (MONTHS[m - 1] ?? "").toUpperCase(), day: String(day).padStart(2, "0") };
}

/** "7:00 PM" */
export function formatTime(date: string) {
  const { h, min } = parts(date);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Nov 4, 2026" */
export function formatDay(date: string) {
  const { y, m, day } = parts(date);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

export function isToday(date: string, now = new Date()) {
  const { y, m, day } = parts(date);
  return now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === day;
}

/** "Today · 7:00 PM · UBC Nest" or "Nov 4, 2026 · 7:00 PM · UBC Nest" */
export function formatEventDetail(date: string, location?: string, now?: Date) {
  const day = isToday(date, now ?? new Date()) ? "Today" : formatDay(date);
  return [day, formatTime(date), location].filter(Boolean).join(" · ");
}
