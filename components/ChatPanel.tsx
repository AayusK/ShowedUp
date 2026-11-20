"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { CHAT_BODY_MAX, GROUP_NAME_MAX, GROUP_PURPOSE_MAX, type ChatGroup, type ChatMessage } from "@/lib/chat";

const POLL_MS = 4000;

interface Person { wallet: string; name: string }

/**
 * Club chat: groups on the left, the open group's messages on the right. Used by officers on the
 * dashboard (club passcode headers) and by members on /chat/[clubId] (their chat token). New
 * messages are fetched every few seconds while the tab is visible.
 */
export function ChatPanel({ clubId, headers, officer, loadMembers }: {
  clubId: string;
  /** Auth headers for every request (club passcode, or the member's chat token). */
  headers: Record<string, string>;
  officer: boolean;
  /** Officers: the club's member list, to pick people for a group. */
  loadMembers?: () => Promise<Person[]>;
}) {
  const base = `/api/chat/${clubId}`;
  const [groups, setGroups] = useState<ChatGroup[] | null>(null);
  const [me, setMe] = useState<string>("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [modal, setModal] = useState<null | "new" | "add">(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headersKey = JSON.stringify(headers);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch(`${base}/groups`, { headers: JSON.parse(headersKey), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "schema_not_ready" ? "Chat isn’t set up yet: run db/07_chat.sql in Supabase." : data.error === "unauthorized" ? "Your chat sign-in expired. Sign in again." : "Couldn’t load the chat.");
        setGroups([]);
        return;
      }
      setError("");
      setGroups(data.groups);
      setMe(data.me?.name ?? "");
      setOpenId((cur) => cur ?? data.groups[0]?.id ?? null);
    } catch {
      setError("Couldn’t reach the server.");
    }
  }, [base, headersKey]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  // Messages of the open group: the newest batch, then only new ones every few seconds.
  const lastId = useRef(0);
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    lastId.current = 0;
    setMessages([]);
    setPeople(null);
    const h = JSON.parse(headersKey);
    const pull = async () => {
      if (document.visibilityState !== "visible" && lastId.current) return;
      try {
        const url = `${base}/groups/${openId}/messages${lastId.current ? `?after=${lastId.current}` : ""}`;
        const res = await fetch(url, { headers: h, cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages: ChatMessage[] };
        if (cancelled || data.messages.length === 0) return;
        lastId.current = data.messages[data.messages.length - 1].id;
        setMessages((m) => [...m, ...data.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      } catch {}
    };
    void pull();
    fetch(`${base}/groups/${openId}`, { headers: h, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d) setPeople(d.people); }).catch(() => {});
    const timer = window.setInterval(pull, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [openId, base, headersKey]);

  // Keep the newest message in view.
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !openId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${base}/groups/${openId}/messages`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ body }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDraft("");
        setError("");
        lastId.current = Math.max(lastId.current, data.message.id);
        setMessages((m) => [...m, data.message]);
      } else setError(data.error === "unauthorized" ? "Your chat sign-in expired. Sign in again." : data.error === "slow_down" ? "You’re sending fast. Wait a minute, then try again." : "Couldn’t send. Try again.");
    } catch { setError("Couldn’t reach the server."); } finally { setSending(false); }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  async function archive() {
    if (!openId) return;
    await fetch(`${base}/groups/${openId}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ archive: true }) });
    setOpenId(null);
    await loadGroups();
  }
  async function removePerson(wallet: string) {
    if (!openId) return;
    await fetch(`${base}/groups/${openId}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ remove: [wallet] }) });
    setPeople((p) => p?.filter((x) => x.wallet !== wallet) ?? null);
    void loadGroups();
  }

  const open = groups?.find((g) => g.id === openId) ?? null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return <div className="chat">
    <aside className="chat-groups" aria-label="Groups">
      <div className="chat-groups-head"><h2>Groups</h2>{officer && <button type="button" className="button primary chat-new" onClick={() => setModal("new")}><Icon name="plus" size={14}/> New group</button>}</div>
      {groups === null ? <p className="chat-muted">Loading…</p> : groups.length === 0 ? <p className="chat-muted">{error || "No groups yet."}</p>
        : <ul>{groups.map((g) => <li key={g.id}><button type="button" className={g.id === openId ? "on" : ""} onClick={() => setOpenId(g.id)}>
            <span className="chat-g-icon" aria-hidden="true">{g.isEveryone ? "#" : Array.from(g.name)[0]?.toUpperCase()}</span>
            <span className="chat-g-text"><strong>{g.name}</strong><small>{g.purpose ?? `${g.memberCount} ${g.memberCount === 1 ? "person" : "people"}`}</small></span>
          </button></li>)}</ul>}
    </aside>

    <section className="chat-room" aria-label={open ? `${open.name} messages` : "Messages"}>
      {!open ? <p className="chat-muted chat-pad">{error || (groups?.length ? "Pick a group." : "")}</p> : <>
        <header className="chat-room-head">
          <div><h3>{open.name}</h3><small>{open.purpose ? `${open.purpose} · ` : ""}{open.memberCount} {open.memberCount === 1 ? "person" : "people"}</small></div>
          {officer && !open.isEveryone && <div className="chat-room-actions">
            <button type="button" className="button secondary" onClick={() => setModal("add")}><Icon name="plus" size={14}/> Add people</button>
            <button type="button" className="button secondary" onClick={archive}>Archive</button>
          </div>}
        </header>
        <div className="chat-msgs" ref={listRef} aria-live="polite">
          {messages.length === 0 ? <p className="chat-muted chat-pad">No messages yet. Say hi.</p>
            : messages.map((m, i) => {
              const mine = m.authorName === me;
              const prev = messages[i - 1];
              const grouped = prev && prev.authorName === m.authorName && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60_000;
              return <div key={m.id} className={`chat-msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>
                {!grouped && <div className="chat-meta"><strong>{mine ? "You" : m.authorName}</strong>{m.authorKind === "officer" && !mine && <span className="chat-officer">Officer</span>}<time dateTime={m.at}>{time(m.at)}</time></div>}
                <p>{m.body}</p>
              </div>;
            })}
        </div>
        {error && <p className="form-error chat-pad" role="alert">{error}</p>}
        <form className="chat-compose" onSubmit={send}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} rows={1} maxLength={CHAT_BODY_MAX} placeholder={`Message ${open.name}`} aria-label={`Message ${open.name}`}/>
          <button type="submit" className="button primary" disabled={sending || !draft.trim()}>Send <Icon name="arrow" size={14}/></button>
        </form>
      </>}
    </section>

    {open && people && <aside className="chat-people" aria-label="People in this group">
      <h3>People · {people.length}</h3>
      <ul>{people.slice(0, 100).map((p) => <li key={p.wallet}><span className="dash-av" aria-hidden="true">{Array.from(p.name)[0]?.toUpperCase()}</span><span>{p.name}</span>{officer && !open.isEveryone && <button type="button" className="text-link" aria-label={`Remove ${p.name}`} onClick={() => removePerson(p.wallet)}>Remove</button>}</li>)}</ul>
    </aside>}

    {modal && officer && loadMembers && <GroupModal
      title={modal === "new" ? "New group" : `Add people to ${open?.name ?? "this group"}`}
      withDetails={modal === "new"}
      exclude={modal === "add" ? new Set(people?.map((p) => p.wallet)) : new Set()}
      loadMembers={loadMembers}
      onClose={() => setModal(null)}
      onSubmit={async ({ name, purpose, wallets }) => {
        const res = modal === "new"
          ? await fetch(`${base}/groups`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, purpose, members: wallets }) })
          : await fetch(`${base}/groups/${openId}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ add: wallets }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.message ?? (data.error === "schema_not_ready" ? "Run db/07_chat.sql in Supabase first." : "Couldn’t save. Try again.");
        setModal(null);
        await loadGroups();
        if (modal === "new" && data.id) setOpenId(data.id);
        else if (openId) { const r = await fetch(`${base}/groups/${openId}`, { headers, cache: "no-store" }); if (r.ok) setPeople((await r.json()).people); }
        return null;
      }}
    />}
  </div>;
}

/** Create a group, or add people to one: pick from the club's members. */
function GroupModal({ title, withDetails, exclude, loadMembers, onClose, onSubmit }: {
  title: string; withDetails: boolean; exclude: Set<string>;
  loadMembers: () => Promise<Person[]>; onClose: () => void;
  onSubmit: (v: { name: string; purpose: string; wallets: string[] }) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [members, setMembers] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { loadMembers().then(setMembers).catch(() => setMembers([])); }, [loadMembers]);
  const shown = (members ?? []).filter((m) => !exclude.has(m.wallet) && m.name.toLowerCase().includes(q.trim().toLowerCase()));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (withDetails && !name.trim()) { setError("Give the group a name."); return; }
    if (!withDetails && picked.size === 0) { setError("Pick at least one person."); return; }
    setBusy(true); setError("");
    const msg = await onSubmit({ name, purpose, wallets: [...picked] }).catch(() => "Couldn’t reach the server.");
    setBusy(false);
    if (msg) setError(msg);
  }
  return <div className="modal-overlay" onClick={() => !busy && onClose()}>
    <form role="dialog" aria-modal="true" aria-label={title} className="modal chat-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
      <h2>{title}</h2>
      {withDetails && <>
        <label className="field">Group name<input value={name} maxLength={GROUP_NAME_MAX} placeholder="e.g. Hackathon volunteers" autoFocus onChange={(e) => setName(e.target.value)}/></label>
        <label className="field">What it’s for<input value={purpose} maxLength={GROUP_PURPOSE_MAX} placeholder="e.g. Setup and check-in desk on Saturday" onChange={(e) => setPurpose(e.target.value)}/></label>
      </>}
      <label className="field">People<input value={q} placeholder="Search members" onChange={(e) => setQ(e.target.value)}/></label>
      <div className="award-list chat-pick">{members === null ? <p>Loading members…</p> : shown.length === 0 ? <p>No members match. Members appear after their first check-in.</p>
        : shown.map((m) => <label key={m.wallet} className="award-person"><input type="checkbox" checked={picked.has(m.wallet)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(m.wallet); else n.delete(m.wallet); return n; })}/><span>{m.name}</span><small>{m.wallet.slice(0, 4)}…{m.wallet.slice(-4)}</small></label>)}</div>
      <button type="submit" className="button primary full" disabled={busy}>{busy ? "Saving…" : withDetails ? `Create group${picked.size ? ` with ${picked.size}` : ""}` : `Add ${picked.size || ""} ${picked.size === 1 ? "person" : "people"}`}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <small>Only people who checked in to your club can be added. They see each other’s names in this group.</small>
    </form>
  </div>;
}
