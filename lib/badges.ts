// What a badge can say about someone. Shared by the browser and the server.

/** "attendance": they were there (claimed with the QR code). "contribution": an officer recorded what they did. */
export type BadgeKind = "attendance" | "contribution";

/** The fixed list of roles a badge can carry. Attendance badges are always "Attendee". */
export const ROLES = ["Attendee", "Volunteer", "Speaker", "Mentor", "Organizer", "Officer"] as const;
export type Role = (typeof ROLES)[number];

/** The roles an officer can award as a contribution. */
export const CONTRIBUTION_ROLES: Role[] = ROLES.filter((r) => r !== "Attendee");

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Reads `kind` and `role` as stored in a token or a database row. Anything missing or unknown reads as plain attendance. */
export function readKindAndRole(kind: unknown, role: unknown): { kind: BadgeKind; role: Role } {
  if (kind === "contribution" && isRole(role) && role !== "Attendee") return { kind: "contribution", role };
  return { kind: "attendance", role: "Attendee" };
}
