"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ReceiptDownload } from "@/components/ReceiptDownload";
import { Icon } from "@/components/Icon";
import { explorerLink } from "@/lib/solana";
import { ROLES } from "@/lib/badges";
import { LEGACY_CLUB_NAME, type ClubInfo } from "@/lib/clubs";
import { clubHeaders, type OrganizerSession } from "@/lib/organizerSession";
import { shortAddress } from "@/lib/profileClient";
import {
  MIN_COUNT_MAX,
  MIN_COUNT_MIN,
  OPENING_DESCRIPTION_MAX,
  OPENING_TITLE_MAX,
  formatClosingDay,
  ruleSentence,
  type Applicant,
  type ApplicationStatus,
  type ClubOpening,
  type Decision,
} from "@/lib/openings";

const STATUS_LABEL: Record<ApplicationStatus, string> = { pending: "Waiting for a decision", accepted: "Accepted", declined: "Declined" };

interface ApplicantList {
  applicants: Applicant[];
  total: number;
}

/** "2 badges counted: Hack Club 1 · UBC Builders Club 1" */
function recordSummary(a: Applicant, needed: number): string {
  if (!a.summary) return "Couldn’t read this track record from Solana just now. Close and reopen the list to try again.";
  const { counted, byClub } = a.summary;
  const head = `${counted} ${counted === 1 ? "badge counts" : "badges count"} toward the rule (${needed} needed)`;
  return byClub.length > 0 ? `${head}: ${byClub.map((c) => `${c.club} ${c.count}`).join(" · ")}` : head;
}

/**
 * A club's openings on the organizer page: post an opening with a rule, see who applied, and
 * accept or decline. Shown to any signed-in officer. Every action sends the club's passcode and
 * is checked again on the server, which also makes sure the opening belongs to this club.
 */
export function OpeningsPanel({ session, club }: { session: OrganizerSession; club: ClubInfo | null }) {
  const [openings, setOpenings] = useState<ClubOpening[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [minCount, setMinCount] = useState("1");
  const [closes, setCloses] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Which opening's applicants are shown, and the applicants loaded so far.
  const [openId, setOpenId] = useState("");
  const [list, setList] = useState<ApplicantList | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [rowBusy, setRowBusy] = useState("");
  // Closing dates are shown in the officer's own timezone, so only after the page has loaded.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const clubName = club?.name ?? LEGACY_CLUB_NAME;
  const { clubId, password } = session;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/openings?mine=1", { cache: "no-store", headers: clubHeaders({ clubId, password }) });
      if (res.status === 401) { setLoadError("Your organizer session expired. Lock and sign in again."); setOpenings([]); return; }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { openings: ClubOpening[] };
      setOpenings(data.openings);
      setLoadError("");
    } catch {
      setLoadError("Couldn’t load openings. Check that the openings tables exist (db/03_openings.sql), then refresh.");
      setOpenings([]);
    }
  }, [clubId, password]);
  useEffect(() => { setOpenId(""); setList(null); load(); }, [load]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setModal(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Give the opening a title."); return; }
    const count = Number(minCount);
    if (!Number.isInteger(count) || count < MIN_COUNT_MIN || count > MIN_COUNT_MAX) { setError(`Ask for between ${MIN_COUNT_MIN} and ${MIN_COUNT_MAX} badges.`); return; }
    // The opening stays open through the end of the chosen day, in the officer's own timezone.
    let closesAt = "";
    if (closes) {
      const [y, m, d] = closes.split("-").map(Number);
      const end = new Date(y, m - 1, d, 23, 59, 59);
      if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) { setError("Pick a closing date that hasn’t passed."); return; }
      closesAt = end.toISOString();
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/openings", {
        method: "POST",
        headers: { "content-type": "application/json", ...clubHeaders(session) },
        body: JSON.stringify({ title, description, role, minCount: count, closesAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setModal(false);
        setTitle("");
        setDescription("");
        setRole("");
        setMinCount("1");
        setCloses("");
        await load();
        return;
      }
      switch (data.error) {
        case "unauthorized": setError("Your organizer session expired. Lock and sign in again."); break;
        case "invalid_input": setError(data.message ?? "Check the opening’s details and try again."); break;
        default: setError("Couldn’t save the opening. Check that the openings tables exist (db/03_openings.sql), then try again.");
      }
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Loads the next page of applicants. The server reads each applicant's badges from Solana, a
  // limited number per request, so a long list arrives in pages.
  async function loadApplicants(id: string, offset: number, known: Applicant[]) {
    setListBusy(true);
    setListError("");
    try {
      const res = await fetch(`/api/openings/${id}/applications?offset=${offset}`, { cache: "no-store", headers: clubHeaders(session) });
      if (res.status === 401) { setListError("Only this club’s officers can see applicants. Lock and sign in again."); return; }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as ApplicantList;
      const seen = new Set(known.map((a) => a.wallet));
      setList({ applicants: [...known, ...data.applicants.filter((a) => !seen.has(a.wallet))], total: data.total });
    } catch {
      setListError("Couldn’t load applicants. Try again in a moment.");
    } finally {
      setListBusy(false);
    }
  }

  function toggleApplicants(id: string) {
    setListError("");
    if (openId === id) { setOpenId(""); setList(null); return; }
    setOpenId(id);
    setList(null);
    void loadApplicants(id, 0, []);
  }

  async function decide(openingId: string, applicant: Applicant, status: Decision) {
    setRowBusy(applicant.wallet);
    setListError("");
    try {
      const res = await fetch(`/api/openings/${openingId}/applications`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...clubHeaders(session) },
        body: JSON.stringify({ wallet: applicant.wallet, status }),
      });
      if (res.ok) {
        setList((l) => l && { ...l, applicants: l.applicants.map((a) => (a.wallet === applicant.wallet ? { ...a, status } : a)) });
        if (applicant.status === "pending") setOpenings((os) => os && os.map((o) => (o.id === openingId ? { ...o, pending: Math.max(0, o.pending - 1) } : o)));
      } else if (res.status === 401) {
        setListError("Only this club’s officers can decide. Lock and sign in again.");
      } else {
        setListError("Couldn’t save that decision. Try again.");
      }
    } catch {
      setListError("Couldn’t reach the server. Try again.");
    } finally {
      setRowBusy("");
    }
  }

  const previewCount = Number.isInteger(Number(minCount)) && Number(minCount) >= MIN_COUNT_MIN && Number(minCount) <= MIN_COUNT_MAX ? Number(minCount) : null;

  return <>
    <div className="section-heading openings-heading"><div><span className="eyebrow">{clubName.toUpperCase()} · OPENINGS</span><h2>Openings</h2></div><button className="button secondary" onClick={() => { setError(""); setModal(true); }}><Icon name="plus" size={17}/> Post an opening</button></div>
    <div className="panel event-list openings-list">
      {openings === null && <div className="event-row"><div className="event-info"><h3>Loading openings…</h3></div></div>}
      {openings !== null && openings.length === 0 && <div className="event-row"><div className="event-info"><h3>{loadError ? "Couldn’t load openings." : "No openings yet."}</h3><p>{loadError || "Post an opening with a rule, and pick people from track records you can check yourself."}</p></div></div>}
      {openings?.map((o) => <div className="opening-item" key={o.id}>
        <div className="event-row"><span className="history-check"><Icon name="people" size={17}/></span><div className="event-info"><h3>{o.title}</h3><p>{ruleSentence(o.role, o.minCount)} · {o.closed ? "Closed" : o.closesAt && mounted ? `Open until ${formatClosingDay(o.closesAt)}` : "Open"}</p></div><span className="row-count"><Icon name="people" size={16}/>{o.applications} {o.applications === 1 ? "application" : "applications"}{o.pending > 0 ? ` · ${o.pending} to decide` : ""}</span><Link className="pill-link" href={`/openings/${o.id}`}>Public page <Icon name="arrow" size={14}/></Link><button className="button secondary" aria-expanded={openId === o.id} onClick={() => toggleApplicants(o.id)}>{openId === o.id ? "Hide applicants" : "See applicants"}</button></div>
        {openId === o.id && <div className="applicants">
          {list === null && listBusy && <p className="applicants-note">Reading track records from Solana…</p>}
          {list !== null && list.applicants.length === 0 && <p className="applicants-note">Nobody has applied yet. Share the public page with students.</p>}
          {list?.applicants.map((a) => <div className="applicant-row" key={a.wallet}>
            <div className="event-info"><h3>{a.name ?? shortAddress(a.wallet)}</h3><p>{recordSummary(a, o.minCount)}</p>
              <div className="applicant-links"><Link className="text-link" href={`/profile/${a.wallet}`}>Track record <Icon name="arrow" size={13}/></Link><a className="text-link" href={explorerLink(a.wallet)} target="_blank" rel="noreferrer">Wallet on Solana Explorer <Icon name="external" size={13}/></a>{a.summary?.badges.map(b => <span key={b.receiptFile?.receipt.signature ?? b.mint}>
                <a className="text-link" href={b.receiptFile ? explorerLink(b.receiptFile.receipt.signature, "tx") : explorerLink(b.mint!)} target="_blank" rel="noreferrer">{b.role} · {b.name} <Icon name="external" size={13}/></a>
                {b.receiptFile && <ReceiptDownload file={b.receiptFile}/>}
              </span>)}</div></div>
            <span className={`quiet-pill applicant-status ${a.status}`}>{STATUS_LABEL[a.status]}</span>
            <div className="applicant-actions"><button className="button primary" disabled={rowBusy === a.wallet || a.status === "accepted"} onClick={() => decide(o.id, a, "accepted")}>{rowBusy === a.wallet ? "Saving…" : "Accept"}</button><button className="button secondary" disabled={rowBusy === a.wallet || a.status === "declined"} onClick={() => decide(o.id, a, "declined")}>Decline</button></div>
          </div>)}
          {list !== null && list.applicants.length < list.total && <p className="applicants-note"><button type="button" className="text-link" disabled={listBusy} onClick={() => loadApplicants(o.id, list.applicants.length, list.applicants)}>{listBusy ? "Reading track records from Solana…" : `Show more (${list.total - list.applicants.length} left)`}</button></p>}
          {listError && <p className="form-error" role="alert">{listError}</p>}
        </div>}
      </div>)}
    </div>
    <div className="subtle-notice openings-notice"><Icon name="shield"/>Applicants’ names are shown only here, to your club’s officers. Each record is read from Solana when you open the list. A decision never changes anyone’s track record.</div>
    {modal && <div className="modal-overlay" onClick={() => !busy && setModal(false)}><form role="dialog" aria-modal="true" aria-label="Post an opening" className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" aria-label="Close" disabled={busy} onClick={() => setModal(false)}>×</button><span className="eyebrow">PICK FROM REAL TRACK RECORDS</span><h2>Post an opening.</h2><p>Set a rule. Students check it against their own badges before they apply.</p><label className="field">Title<input value={title} maxLength={OPENING_TITLE_MAX} placeholder="e.g. Hackathon mentor" onChange={e => setTitle(e.target.value)}/></label><label className="field">Description<textarea value={description} maxLength={OPENING_DESCRIPTION_MAX} rows={3} placeholder="What they’d do, and when (optional)" onChange={e => setDescription(e.target.value)}/></label><div className="form-columns"><label className="field">Badges that count<select value={role} onChange={e => setRole(e.target.value)}><option value="">Any verified badge</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label><label className="field">How many<input type="number" inputMode="numeric" min={MIN_COUNT_MIN} max={MIN_COUNT_MAX} step={1} value={minCount} onChange={e => setMinCount(e.target.value)}/></label></div><label className="field">Closes on<input type="date" value={closes} onChange={e => setCloses(e.target.value)}/></label>{previewCount !== null && <p className="opening-preview">The rule: <strong>{ruleSentence(ROLES.find((r) => r === role) ?? null, previewCount)}</strong></p>}<button type="submit" className="button primary full" disabled={busy}>{busy ? "Posting opening…" : "Post opening"} <Icon name="arrow" size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small>Leave the closing date empty to keep it open. Anyone can see the opening and its rule; only your club’s officers see who applied.</small></form></div>}
  </>;
}
