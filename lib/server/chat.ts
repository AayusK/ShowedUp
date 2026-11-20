import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "./db";
import { authorizeClub } from "./auth";
import { readEvents } from "./events";
import { clubMembers } from "./members";
import { newId } from "./ids";
import { CHAT_NAME_MAX, cleanText, type ChatGroup, type ChatMessage } from "@/lib/chat";

// Postgres / PostgREST codes for "that table doesn't exist": db/07_chat.sql hasn't been run.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
export class ChatNotReadyError extends Error {}
function check<T extends { error: { code?: string; message: string } | null }>(r: T, what: string): T {
  if (r.error && MISSING_TABLE.has(r.error.code ?? "")) throw new ChatNotReadyError();
  if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  return r;
}

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

// ---- Member sign-in tokens -------------------------------------------------------------------
// After a member proves their wallet with a signature, they get a token for 7 days:
// "<wallet>.<clubId>.<expiry>.<hmac>". The HMAC key is EVENT_SECRET with a "chat:" prefix, so it
// can't be confused with a check-in code. Nothing is stored; the server recomputes it.
const TOKEN_DAYS = 7;
function tokenKey(): string {
  const s = process.env.EVENT_SECRET;
  if (!s) throw new Error("EVENT_SECRET is not set");
  return `chat:${s}`;
}
function sign(payload: string): string {
  return createHmac("sha256", tokenKey()).update(payload).digest("base64url");
}
export function issueMemberToken(wallet: string, clubId: string): { token: string; expiresAt: string } {
  const exp = Date.now() + TOKEN_DAYS * 86_400_000;
  const payload = `${wallet}.${clubId}.${exp}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}
function readMemberToken(token: string | null, clubId: string): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [wallet, club, exp, mac] = parts;
  if (club !== clubId || !(Number(exp) > Date.now())) return null;
  const want = Buffer.from(sign(`${wallet}.${club}.${exp}`));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? wallet : null;
}

// ---- Who is asking ----------------------------------------------------------------------------
export type ChatActor =
  | { kind: "officer"; clubId: string; name: string }
  | { kind: "member"; clubId: string; wallet: string; name: string };

/** Members of a club: people who checked in themselves (the same rule names follow everywhere). */
export async function memberDirectory(clubId: string): Promise<Map<string, string>> {
  const list = await clubMembers(await readEvents(clubId));
  return new Map(list.map((m) => [m.wallet, m.name]));
}

/**
 * Officers: the club passcode (x-club-id + x-organizer-password), with an optional display label
 * in x-chat-name ("President"). Members: a token from /session in x-chat-token, still a member.
 */
export async function chatActor(request: Request, clubId: string): Promise<ChatActor | null> {
  const club = await authorizeClub(request);
  if (club && club.id === clubId) {
    const label = cleanText(decodeURIComponent(request.headers.get("x-chat-name") ?? ""), CHAT_NAME_MAX);
    return { kind: "officer", clubId, name: label ? `${label} (officer)` : "Officer" };
  }
  const wallet = readMemberToken(request.headers.get("x-chat-token"), clubId);
  if (!wallet) return null;
  const name = (await memberDirectory(clubId)).get(wallet);
  if (!name) return null; // no longer a member (e.g. their badge was revoked)
  return { kind: "member", clubId, wallet, name };
}

// ---- Groups -----------------------------------------------------------------------------------
interface GroupRow { id: string; club_id: string; name: string; purpose: string | null; is_everyone: boolean; archived_at: string | null }

async function ensureEveryone(clubId: string): Promise<void> {
  const { data } = check(await db().from("chat_groups").select("id").eq("club_id", clubId).eq("is_everyone", true).maybeSingle(), "chat group read");
  if (data) return;
  const { error } = await db().from("chat_groups").insert({ id: newId(), club_id: clubId, name: "Everyone", purpose: "The whole club", is_everyone: true });
  if (error && error.code !== "23505") check({ error }, "chat group create"); // 23505: another request just made it
}

/** Groups this actor can see: officers see all; members see Everyone plus groups they're in. */
export async function listGroups(actor: ChatActor): Promise<ChatGroup[]> {
  await ensureEveryone(actor.clubId);
  const { data } = check(await db().from("chat_groups").select("id, club_id, name, purpose, is_everyone, archived_at").eq("club_id", actor.clubId).is("archived_at", null).order("created_at"), "chat groups read");
  const groups = (data ?? []) as GroupRow[];
  const ids = groups.filter((g) => !g.is_everyone).map((g) => g.id);
  const { data: rows } = ids.length ? check(await db().from("chat_group_members").select("group_id, wallet").in("group_id", ids), "chat members read") : { data: [] };
  const membersOf = new Map<string, string[]>();
  for (const r of (rows ?? []) as { group_id: string; wallet: string }[]) membersOf.set(r.group_id, [...(membersOf.get(r.group_id) ?? []), r.wallet]);
  const clubSize = (await memberDirectory(actor.clubId)).size;
  return groups
    .filter((g) => g.is_everyone || actor.kind === "officer" || (membersOf.get(g.id) ?? []).includes(actor.wallet))
    .sort((a, b) => Number(b.is_everyone) - Number(a.is_everyone))
    .map((g) => ({ id: g.id, name: g.name, purpose: g.purpose, isEveryone: g.is_everyone, memberCount: g.is_everyone ? clubSize : (membersOf.get(g.id) ?? []).length }));
}

async function groupFor(actor: ChatActor, groupId: string): Promise<GroupRow | null> {
  const { data } = check(await db().from("chat_groups").select("id, club_id, name, purpose, is_everyone, archived_at").eq("id", groupId).maybeSingle(), "chat group read");
  const g = data as GroupRow | null;
  if (!g || g.club_id !== actor.clubId || g.archived_at) return null;
  if (g.is_everyone || actor.kind === "officer") return g;
  const { data: m } = check(await db().from("chat_group_members").select("wallet").eq("group_id", g.id).eq("wallet", actor.wallet).maybeSingle(), "chat member read");
  return m ? g : null;
}

/** Officers only. Members must be people in the club's member list. */
export async function createGroup(clubId: string, name: string, purpose: string, wallets: string[]): Promise<string> {
  const directory = await memberDirectory(clubId);
  const id = newId();
  check(await db().from("chat_groups").insert({ id, club_id: clubId, name, purpose: purpose || null }), "chat group create");
  const valid = [...new Set(wallets)].filter((w) => directory.has(w)).slice(0, 200);
  if (valid.length) check(await db().from("chat_group_members").insert(valid.map((wallet) => ({ group_id: id, wallet }))), "chat members add");
  return id;
}

/** Officers only: add or remove people, or archive the group. */
export async function updateGroup(actor: ChatActor, groupId: string, change: { add?: string[]; remove?: string[]; archive?: boolean }): Promise<boolean> {
  if (actor.kind !== "officer") return false;
  const g = await groupFor(actor, groupId);
  if (!g || g.is_everyone) return false;
  if (change.archive) { check(await db().from("chat_groups").update({ archived_at: new Date().toISOString() }).eq("id", g.id), "chat group archive"); return true; }
  const directory = await memberDirectory(actor.clubId);
  const add = [...new Set(change.add ?? [])].filter((w) => directory.has(w));
  if (add.length) check(await db().from("chat_group_members").upsert(add.map((wallet) => ({ group_id: g.id, wallet }))), "chat members add");
  if (change.remove?.length) check(await db().from("chat_group_members").delete().eq("group_id", g.id).in("wallet", change.remove), "chat members remove");
  return true;
}

/** The group's people, for the members panel. Names follow the club's member list. */
export async function groupPeople(actor: ChatActor, groupId: string): Promise<{ wallet: string; name: string }[] | null> {
  const g = await groupFor(actor, groupId);
  if (!g) return null;
  const directory = await memberDirectory(actor.clubId);
  if (g.is_everyone) return [...directory].map(([wallet, name]) => ({ wallet, name }));
  const { data } = check(await db().from("chat_group_members").select("wallet").eq("group_id", g.id), "chat members read");
  return ((data ?? []) as { wallet: string }[]).map((r) => ({ wallet: r.wallet, name: directory.get(r.wallet) ?? short(r.wallet) }));
}

// ---- Messages ---------------------------------------------------------------------------------
interface MessageRow { id: number; author_kind: "officer" | "member"; author_wallet: string | null; author_name: string; body: string; created_at: string }
const toMessage = (r: MessageRow): ChatMessage => ({ id: r.id, authorKind: r.author_kind, authorName: r.author_name, authorWallet: r.author_wallet ? short(r.author_wallet) : null, body: r.body, at: r.created_at });

/** The newest 60 messages, or only those after `after` (for polling). Null if no access. */
export async function readMessages(actor: ChatActor, groupId: string, after?: number): Promise<ChatMessage[] | null> {
  if (!(await groupFor(actor, groupId))) return null;
  let q = db().from("chat_messages").select("id, author_kind, author_wallet, author_name, body, created_at").eq("group_id", groupId);
  if (after) q = q.gt("id", after).order("id", { ascending: true }).limit(100);
  else q = q.order("id", { ascending: false }).limit(60);
  const { data } = check(await q, "chat messages read");
  const rows = (data ?? []) as MessageRow[];
  return (after ? rows : rows.reverse()).map(toMessage);
}

export async function postMessage(actor: ChatActor, groupId: string, body: string): Promise<ChatMessage | null> {
  if (!(await groupFor(actor, groupId))) return null;
  const { data } = check(await db().from("chat_messages").insert({
    group_id: groupId, author_kind: actor.kind, author_wallet: actor.kind === "member" ? actor.wallet : null, author_name: actor.name, body,
  }).select("id, author_kind, author_wallet, author_name, body, created_at").single(), "chat message save");
  return toMessage(data as MessageRow);
}
