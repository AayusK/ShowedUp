"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { OrganizerAccessModal } from "@/components/OrganizerAccessModal";
import { AwardModal } from "../AwardModal";
import { formatDay } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { checkSession, clubHeaders, readSession, saveSession, type OrganizerSession } from "@/lib/organizerSession";
import type { EventRecord } from "@/lib/server/events";
import type { Attendee } from "@/lib/server/members";

/**
 * The page for a contribution badge (e.g. "Mentor"): who has it, and a way to award it to more
 * people. There is no QR code here; contribution badges are only ever awarded by an officer.
 */
export default function RecipientsView({ event, club }: { event: EventRecord; club: { id: string; name: string } }) {
  // The officer's sign-in. It must be for the club this badge belongs to.
  const [session, setSession] = useState<OrganizerSession | null>(null);
  const [checkedSaved, setCheckedSaved] = useState(false);
  const [accessModal, setAccessModal] = useState(false);
  const [awardModal, setAwardModal] = useState(false);
  const [recipients, setRecipients] = useState<Attendee[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const saved = readSession();
    if (!saved || saved.clubId !== club.id) { setCheckedSaved(true); setAccessModal(true); return; }
    checkSession(saved)
      .then((check) => {
        if (check.ok) setSession(saved);
        else { saveSession(null); setAccessModal(true); }
      })
      .catch(() => setSession(saved))
      .finally(() => setCheckedSaved(true));
  }, [club.id]);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/events/${event.id}/attendees`, { headers: clubHeaders(session), cache: "no-store" });
      if (res.status === 401) { saveSession(null); setSession(null); setAccessModal(true); return; }
      if (!res.ok) { setLoadError(true); return; }
      const data = (await res.json()) as { attendees: Attendee[] };
      setRecipients(data.attendees);
      setLoadError(false);
    } catch { setLoadError(true); }
  }, [event.id, session]);
  useEffect(() => { load(); }, [load]);

  return <><SiteHeader view="event" />
  <main className="shell">
    <Link className="back-link" href="/organizer">← All events</Link>
    <div className="page-intro"><Badge>{club.name} · Contribution badge</Badge><h1>{event.name}<span className="green-period">.</span></h1><p>{event.role} · {formatDay(event.date)}</p></div>
    <div className="section-heading"><div><span className="eyebrow">ON THEIR TRACK RECORD</span><h2>Who has this badge</h2></div><button className="button primary" disabled={!session} onClick={() => setAwardModal(true)}><Icon name="plus" size={17}/> Award to more people</button></div>
    <div className="panel event-list recipients-list">
      {recipients === null && <div className="event-row"><div className="event-info"><h3>{loadError ? "Couldn’t load who has this badge." : !checkedSaved || session ? "Loading…" : "Sign in to see who has this badge."}</h3>{loadError && <p>Refresh the page to try again.</p>}</div></div>}
      {recipients?.length === 0 && <div className="event-row"><div className="event-info"><h3>Nobody yet.</h3><p>Award it to someone who checked in, or paste a wallet address.</p></div></div>}
      {recipients?.map((r) => <div className="event-row" key={r.wallet}><span className="history-check"><Icon name="check" size={17}/></span><div className="event-info"><h3>{r.name}</h3><p>{r.wallet.slice(0, 4)}…{r.wallet.slice(-4)}</p></div><a className="pill-link" href={`/profile/${r.wallet}`}>Track record <Icon name="arrow" size={14}/></a></div>)}
    </div>
    <div className="token-details"><Icon name="shield" size={17}/><span>Badge token<small>{event.name} · {event.role} · Token-2022 · Nontransferable · issued by {club.name}</small></span><a className="pill-link" href={explorerLink(event.mint)} target="_blank" rel="noreferrer">View on Explorer <Icon name="external" size={14}/></a></div>
  </main><SiteFooter />
  {accessModal && <OrganizerAccessModal fixedClub={club} onClose={() => setAccessModal(false)} onUnlocked={(unlocked) => { setSession(unlocked.session); setAccessModal(false); }} />}
  {awardModal && session && <AwardModal session={session} existing={{ id: event.id, name: event.name, role: event.role }} onClose={() => setAwardModal(false)} onChanged={load} />}
  </>;
}
