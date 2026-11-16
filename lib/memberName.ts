// Display names attendees give on the claim screen. Shared by the browser and the server.
export const NAME_MAX = 40;

/** Trims, collapses whitespace and strips control characters. Returns "" if nothing usable is left. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}
