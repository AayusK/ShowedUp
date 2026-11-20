// The live feed on the home page: badges the QuickNode Stream saw being handed out on Solana,
// across every verified club. Shared by the browser and the server; nothing secret lives here.

interface TokenFeedItem {
  /** Shortened "abcd…wxyz". The full address is never sent. */
  wallet: string;
  /** Only for contribution badges (Volunteer, Speaker, ...). Null for attendance. */
  role: string | null;
  kind: "attendance" | "contribution";
  /** The issuing club's name. */
  club: string;
  eventName: string;
  /** When Solana confirmed it (ISO). */
  at: string;
  /** The transaction that minted the badge. */
  signature: string;
}

export type FeedItem = TokenFeedItem | {
  kind: "receipt";
  club: string;
  at: string;
  signature: string;
};

export interface FeedResponse {
  items: FeedItem[];
  /** "off" when no stream is connected yet (no table or no rows). */
  stream: "on" | "off";
}

export function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/**
 * How to show any feed item in one line. Receipts carry no person or event on purpose (they're
 * private); token badges show the role (or "Attended"), the event and a short wallet.
 */
export function feedText(item: FeedItem): { title: string; detail: string; isRole: boolean } {
  if (item.kind === "receipt") return { title: "Contribution confirmed", detail: `${item.club} · signed receipt`, isRole: true };
  return { title: item.role ?? "Attended", detail: `${item.eventName} · ${item.wallet}`, isRole: item.kind === "contribution" };
}
