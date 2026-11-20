// Club chat, shared by the browser and the server. Nothing secret lives here.

export const CHAT_BODY_MAX = 1000;
export const GROUP_NAME_MAX = 40;
export const GROUP_PURPOSE_MAX = 140;
export const CHAT_NAME_MAX = 40;

export interface ChatGroup {
  id: string;
  name: string;
  purpose: string | null;
  isEveryone: boolean;
  /** How many members (the Everyone group counts every club member). */
  memberCount: number;
}

export interface ChatMessage {
  id: number;
  authorKind: "officer" | "member";
  authorName: string;
  /** Short wallet for members ("abcd…wxyz"); null for officers. */
  authorWallet: string | null;
  body: string;
  at: string;
}

/** The text a member's wallet signs to open their club's chat. */
export function chatSignInMessage(clubId: string, wallet: string, signedAt: string): string {
  return `ShowedUp club chat sign-in\nClub: ${clubId}\nWallet: ${wallet}\nTime: ${signedAt}`;
}

/** Trims and drops control characters; keeps line breaks only when asked. */
export function cleanText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== "string") return "";
  const s = raw.replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, "");
  return (multiline ? s.replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ")).trim().slice(0, max);
}
