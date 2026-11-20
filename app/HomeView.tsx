"use client";

import Link from "next/link";
import React, { useState, useEffect } from "react";
import { Icon } from "@/components/Icon";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { formatEventDetail, isToday } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { formatClosingDay, ruleSentence, type OpeningInfo } from "@/lib/openings";
import { feedText, timeAgo, type FeedItem, type FeedResponse } from "@/lib/feed";

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


  // Newest first; the three most recent events.
  const recent = [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  // An event happening today gets a small banner (worked out in the browser, in local time).
  const todayEvent = clientNow ? recent.find((e) => isToday(e.date, clientNow)) : undefined;

  return <><SiteHeader view="home" />
  <main className="shell home2">
    <section className="home2-hero">
      <div className="home2-copy">
        <span className="home2-pill"><i/> Proof of showing up, on Solana</span>
        <h1>Every time you show up,<br/><span>it adds up.</span></h1>
        <p>Clubs record when you show up and sign what you contributed, like mentoring or speaking. Your track record goes with you to the next club. No fees, no crypto know-how needed.</p>
        <div className="home2-actions">
          <Link className="button primary" href="/profile/me">See my track record <Icon name="arrow" size={16}/></Link>
          <Link className="button secondary" href="/organizer">Run a club <Icon name="arrow" size={16}/></Link>
        </div>
        {todayEvent && <p className="home2-today"><span className="home2-live"/> Checking in today: <strong>{todayEvent.name}</strong> · {formatEventDetail(todayEvent.date, todayEvent.location, clientNow ?? undefined)}</p>}
      </div>
      <div className="home2-card" aria-hidden="true">
        <div className="home2-card-top"><span>Track record</span><span><Icon name="shield" size={12}/> Verified on Solana</span></div>
        <strong className="home2-card-tier">Regular</strong>
        <span className="home2-card-wallet">Fq3b…NwRy</span>
        <div className="home2-card-bar"><i style={{width: "80%"}}/></div>
        <div className="home2-card-meta"><span>4 of 5 events</span><span>1 more to Core Member</span></div>
        <div className="home2-card-pills"><span className="rec-pill rec-role-Mentor">1 × Mentor</span><span className="rec-pill rec-role-Speaker">1 × Speaker</span><span className="rec-pill">4 events</span></div>
      </div>
    </section>

    <section className="home2-grid">
      <div className="home2-panel">
        <div className="home2-panel-head"><h2>Live across clubs</h2><span className="home2-src"><span className="home2-live"/> Solana · QuickNode Streams</span></div>
        {feed && feed.items.length > 0
          ? <ul className="home2-feed">{feed.items.map((item) => <li key={item.signature}>
              <span className={`home2-feed-ic${feedText(item).isRole ? " is-role" : ""}`}><Icon name={feedText(item).isRole ? "spark" : "check"} size={15}/></span>
              <div><strong>{feedText(item).title} <span>· {item.club}</span></strong><small>{feedText(item).detail}</small></div>
              <a href={explorerLink(item.signature, "tx")} target="_blank" rel="noreferrer" aria-label="View on Solana">{timeAgo(item.at, feed.now)} <Icon name="external" size={12}/></a>
            </li>)}</ul>
          : <p className="home2-empty">{feed === null ? "Loading the live feed…" : "Quiet right now. New badges appear here the moment Solana confirms them."}</p>}
      </div>
      <div className="home2-panel">
        <div className="home2-panel-head"><h2>Open right now</h2><span className="home2-src">Checked against your badges</span></div>
        {openings.length > 0
          ? <ul className="home2-openings">{openings.map((o) => <li key={o.id}><Link href={`/openings/${o.id}`}>
              <div><strong>{o.title}</strong><small>{o.clubName} · {ruleSentence(o.role, o.minCount)}</small></div>
              <span>{o.closesAt && clientNow ? `Until ${formatClosingDay(o.closesAt)}` : "Open"} <Icon name="arrow" size={14}/></span>
            </Link></li>)}</ul>
          : <p className="home2-empty">No openings yet. Clubs post them when they need mentors, speakers or volunteers.</p>}
      </div>
    </section>
  </main><SiteFooter /></>;
}
