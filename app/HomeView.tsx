"use client";

import Link from "next/link";
import React, { useState, useEffect } from "react";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { AttendanceCard } from "@/components/AttendanceCard";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { dateTile, formatEventDetail, isToday } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { formatClosingDay, ruleSentence, type OpeningInfo } from "@/lib/openings";
import { timeAgo, type FeedItem, type FeedResponse } from "@/lib/feed";

const FEED_POLL_MS = 15_000;

/**
 * Polls /api/feed every 15 s, only while the tab is visible, and once more when the tab comes
 * back into view. Returns null until the first answer arrives.
 */
function useLiveFeed() {
  const [feed, setFeed] = useState<{ items: FeedItem[]; stream: FeedResponse["stream"]; now: Date } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch("/api/feed", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as Partial<FeedResponse>;
        if (cancelled) return;
        setFeed({
          items: Array.isArray(body.items) ? body.items : [],
          stream: body.stream === "on" ? "on" : "off",
          now: new Date(),
        });
      } catch {
        // Offline for a moment: keep showing what we have and try again on the next tick.
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, FEED_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return feed;
}

interface HomeEvent {
  id: string;
  name: string;
  date: string;
  location?: string;
  mint: string | null;
}

type HomeOpening = Pick<OpeningInfo, "id" | "title" | "clubName" | "role" | "minCount" | "closesAt">;

export default function HomeView({ events, openings = [] }: { events: HomeEvent[]; openings?: HomeOpening[] }) {
  const [clientNow, setClientNow] = useState<Date | null>(null);
  const feed = useLiveFeed();
  useEffect(() => { setClientNow(new Date()); }, []);

  // Build a date string for "past/coming up" comparisons — only after mount.
  const todayStr = clientNow
    ? `${clientNow.getFullYear()}-${String(clientNow.getMonth() + 1).padStart(2, "0")}-${String(clientNow.getDate()).padStart(2, "0")}`
    : null;

  // Newest first; the three most recent events.
  const recent = [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  return <><SiteHeader view="home" />
  <main className="shell">
    <section className="hero"><div className="hero-copy"><Badge>Small moments. Lasting proof.</Badge><h1>Every time you<br/>show up.<br/><span>It adds up.</span></h1><p>Your time matters. Turn every club meeting into a little proof of belonging. Yours to keep, wherever you go.</p><div className="actions"><Link className="button primary" href="/profile/me">View my track record <Icon name="arrow" size={17}/></Link><Link className="text-link" href="/organizer">Host an event <Icon name="arrow" size={16}/></Link></div><div className="hero-note"><span>Good people. Real connections.<br/><strong>One meeting at a time.</strong></span></div></div><div className="hero-art"><div className="back-card back-one"/><div className="back-card back-two"/><AttendanceCard/><div className="floating-note"><span className="note-check"><Icon name="check" size={16}/></span><div>Another meeting. Another milestone.<small>Your fifth event unlocked Core Member.</small></div></div><span className="art-caption"><Icon name="shield" size={13}/> Yours to keep. Never to trade.</span></div></section>
    <section className="benefit-strip"><div><Icon name="shield"/><span>Proof that stays with you<small>Download the contributions your club confirms.</small></span></div><div><Icon name="wallet"/><span>Just bring yourself<small>No fees. No SOL needed.</small></span></div><div><Icon name="spark"/><span>Consistency opens doors<small>Show up. Unlock your next chapter.</small></span></div></section>
    {recent.length > 0 && <section className="events-section"><div className="section-heading"><div><span className="eyebrow">YOUR COMMUNITY, IN MOTION</span><h2>Make your next appearance.</h2></div><Link className="text-link" href="/profile/me">View my track record <Icon name="arrow" size={16}/></Link></div><div className="event-grid">{recent.map((e, i) => { const tile = dateTile(e.date); const today = clientNow ? isToday(e.date, clientNow) : false; const isPast = todayStr !== null && e.date.slice(0, 10) < todayStr; const Card = e.mint ? "a" : "article"; return <Card key={e.id} {...(e.mint ? { href: explorerLink(e.mint), target: "_blank", rel: "noreferrer" } : {})} className="event-card" style={{"--card-i": i} as React.CSSProperties}><div className="event-card-top"><div className="date-tile"><small>{tile.month}</small>{tile.day}</div>{today ? <Badge>Checking in today</Badge> : <span className="quiet-pill"><Icon name="calendar" size={12}/> {isPast ? "Past event" : "Coming up"}</span>}</div><h3>{e.name}</h3><p>{today ? "Scan the QR code in the room to check in." : e.mint ? "Each attendee holds one nontransferable token." : "Check in with the club’s event QR code."}</p><div className="event-card-bottom"><span>{formatEventDetail(e.date, e.location, clientNow ?? undefined)}</span>{e.mint && <span className="event-card-proof">View token <Icon name="external" size={15}/></span>}</div></Card>; })}</div></section>}
    <section className="events-section live-feed"><div className="section-heading"><div><span className="eyebrow">SEEN ON SOLANA · QUICKNODE STREAMS</span><h2>Live across clubs.</h2></div><Link className="text-link" href="/profile/me">View my track record <Icon name="arrow" size={16}/></Link></div>{feed && feed.items.length > 0 ? <ul className="panel live-feed-list">{feed.items.map((item) => <li className="live-feed-row" key={item.signature}><span className="history-check"><Icon name={item.kind === "attendance" ? "check" : "spark"} size={16}/></span><div className="live-feed-info">{item.kind === "receipt" ? <strong>{item.club} confirmed a contribution</strong> : <><strong>{item.role ?? "Attendance"} <span>· {item.club}</span></strong><small>{item.eventName} · {item.wallet}</small></>}</div><div className="live-feed-meta"><small>{timeAgo(item.at, feed.now)}</small><a className="text-link" href={explorerLink(item.signature, "tx")} target="_blank" rel="noreferrer">View on Solana <Icon name="external" size={13}/></a></div></li>)}</ul> : feed === null ? null : <p className="subtle-notice live-feed-resting"><Icon name="spark" size={15}/> The live feed is resting. Club activity appears here when the stream reports it.</p>}</section>
    {openings.length > 0 && <section className="events-section openings-section"><div className="section-heading"><div><span className="eyebrow">YOUR TRACK RECORD, PUT TO WORK</span><h2>Open right now.</h2></div><Link className="text-link" href="/profile/me">View my track record <Icon name="arrow" size={16}/></Link></div><div className="event-grid">{openings.map((o, i) => <Link href={`/openings/${o.id}`} className="event-card" key={o.id} style={{"--card-i": i} as React.CSSProperties}><div className="event-card-top"><Badge>{o.clubName}</Badge><span className="quiet-pill"><Icon name="calendar" size={12}/> {o.closesAt && clientNow ? `Open until ${formatClosingDay(o.closesAt)}` : "Open"}</span></div><h3>{o.title}</h3><p>{ruleSentence(o.role, o.minCount)}</p><div className="event-card-bottom"><span>Checked against verified receipts and badges</span><span className="event-card-proof">See if you qualify <Icon name="arrow" size={15}/></span></div></Link>)}</div></section>}
    <section className="closing"><span className="little-mark">↗</span><div><h2>Presence has its perks.</h2><p>One event gets you started. Coming back makes you a regular.</p></div><Link href="/profile/me" className="button secondary">Explore your membership <Icon name="arrow" size={16}/></Link></section>
  </main><SiteFooter /></>;
}
