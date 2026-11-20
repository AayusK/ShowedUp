"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ReceiptDownload } from "@/components/ReceiptDownload";
import { Icon } from "@/components/Icon";
import { shortAddress, type Profile, type ProfileEvent } from "@/lib/profileClient";
import { explorerLink } from "@/lib/solana";
import { badgeDetail, groupTrackRecord, roleCounts } from "@/lib/trackRecord";

const TABS = [
  { id: "clubs", label: "Clubs", heading: "Clubs on this record" },
  { id: "attendance", label: "Attendance", heading: "Attendance history" },
  { id: "contributions", label: "Contributions", heading: "Contributions across clubs" },
  { id: "by-club", label: "Attendance by club", heading: "Attendance by club" },
] as const;

function eventCount(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

function BadgeRows({ events, showClub = true }: { events: ProfileEvent[]; showClub?: boolean }) {
  return (
    <ul className="profile-record-list">
      {events.map((event) => {
        const detail = [showClub && event.club.name, badgeDetail(event)].filter(Boolean).join(" · ");
        return (
          <li className="profile-record-row" key={event.id}>
            <div className="profile-record-row-copy">
              <strong>{event.name}</strong>
              {detail && <p>{detail}{!event.club.verified && " · Unverified club"}</p>}
              {event.receiptFile && <><p>{String(event.receiptFile.record.summary ?? "")}</p><ReceiptDownload file={event.receiptFile} /></>}
            </div>
            <span className="profile-record-status">{event.kind === "attendance" ? "Attended" : event.role}</span>
            {(event.mint || event.receiptFile) && <a className="profile-record-proof" href={event.receiptFile ? explorerLink(event.receiptFile.receipt.signature, "tx") : explorerLink(event.mint!)} target="_blank" rel="noreferrer"
              aria-label={`View proof for ${event.name} on Solana Explorer`}>
              <Icon name="external" size={15} />
            </a>}
          </li>
        );
      })}
    </ul>
  );
}

export function ProfileRecord({ profile, isMine }: { profile: Profile; isMine: boolean }) {
  const [selected, setSelected] = useState(0);
  const tab = TABS[selected];
  const clubs = groupTrackRecord(profile.events);
  const attendance = profile.events.filter((event) => event.kind === "attendance");
  const contributions = profile.events.filter((event) => event.kind === "contribution");
  const attendanceByClub = groupTrackRecord(attendance);
  const hasRecords = tab.id === "clubs" ? clubs.length > 0
    : tab.id === "contributions" ? contributions.length > 0 : attendance.length > 0;
  const wallet = shortAddress(profile.wallet);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = (index + TABS.length - 1) % TABS.length; break;
      case "ArrowRight": next = (index + 1) % TABS.length; break;
      case "Home": next = 0; break;
      case "End": next = TABS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setSelected(next);
    event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div className="profile-record">
      <header className="profile-record-identity">
        <div className="profile-record-cover" aria-hidden="true" />
        <div className="profile-record-person">
          <span className="profile-record-avatar" aria-hidden="true"><Icon name="wallet" size={23} /></span>
          <div className="profile-record-name">
            <h1>{isMine ? "Your track record" : "Track record"}</h1>
            <a href={explorerLink(profile.wallet)} target="_blank" rel="noreferrer"
              aria-label={`View wallet ${profile.wallet} on Solana Explorer`}>
              {wallet} <Icon name="external" size={13} />
            </a>
          </div>
          <Link className="profile-record-verify" href="/verify"><Icon name="shield" size={15} /> Verify a wallet</Link>
        </div>
      </header>
      <div className="profile-record-tabs" role="tablist" aria-label="Track record sections">
        {TABS.map((item, index) => (
          <button type="button" role="tab" key={item.id} id={`profile-tab-${item.id}`}
            aria-controls={`profile-panel-${item.id}`} aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1} onClick={() => setSelected(index)}
            onKeyDown={(event) => moveTab(event, index)}>
            {item.label}
          </button>
        ))}
      </div>
      {profile.partial && <p className="profile-record-notice" role="status">Some badges may be missing. Refresh to try again.</p>}
      {TABS.map((item, index) => (
        <section className="profile-record-card" key={item.id} id={`profile-panel-${item.id}`}
          role="tabpanel" aria-labelledby={`profile-tab-${item.id}`} tabIndex={0} hidden={index !== selected}>
          {index === selected && <>
            <header className="profile-record-card-head"><h2>{item.heading}</h2></header>
            {!hasRecords && <p className="profile-record-notice">{
              item.id === "clubs" ? "No verified club badges yet."
                : item.id === "contributions" ? "No verified contributions yet."
                  : "No verified attendance yet."
            }</p>}
            {item.id === "clubs" && clubs.length > 0 && (
              <ul className="profile-record-list">
                {clubs.map(({ club, terms }) => (
                  <li className="profile-record-row" key={club.id}>
                    <span className="profile-record-club-mark" aria-hidden="true">{Array.from(club.name)[0]?.toUpperCase()}</span>
                    <div className="profile-record-row-copy">
                      <strong>{club.name}</strong>
                      <p>{roleCounts(terms.flatMap((term) => term.events)).join(" · ")}</p>
                    </div>
                    <a className="profile-record-proof" href={explorerLink(club.issuer)} target="_blank" rel="noreferrer"
                      aria-label={`View ${club.name}’s issuer on Solana Explorer`}>
                      <Icon name="external" size={15} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {item.id === "attendance" && attendance.length > 0 && <BadgeRows events={attendance} />}
            {item.id === "contributions" && groupTrackRecord(contributions).map(({ club, terms }) => (
              <div key={club.id}>{terms.map(term => <div key={term.label} className="profile-record-term">
                <h3>{club.name} · {term.label}</h3><BadgeRows events={term.events} showClub={false}/>
              </div>)}</div>
            ))}
            {item.id === "by-club" && attendanceByClub.map(({ club, terms }, clubIndex) => (
              <details className="profile-record-group" key={club.id} open={clubIndex === 0}>
                <summary>
                  <strong>{club.name}</strong>
                  <span>{eventCount(terms.reduce((count, term) => count + term.events.length, 0))}</span>
                </summary>
                {terms.map((term) => (
                  <div className="profile-record-term" key={term.label}>
                    <h3>{term.label}</h3>
                    <BadgeRows events={term.events} showClub={false} />
                  </div>
                ))}
              </details>
            ))}
          </>}
        </section>
      ))}
      {(profile.tier || profile.nextTier) && (
        <div className="profile-record-tier">
          {profile.tier && <strong>{profile.tier}</strong>}
          {profile.nextTier && <span>{eventCount(profile.nextTier.remaining)} to {profile.nextTier.name}</span>}
          <TierProgress nextTier={profile.nextTier} />
        </div>
      )}
    </div>
  );
}

/** A thin bar that fills toward the next tier (full once the top tier is reached). */
function TierProgress({ nextTier }: { nextTier: { name: string; min: number; remaining: number } | null }) {
  const attended = nextTier ? nextTier.min - nextTier.remaining : 1;
  const goal = nextTier ? nextTier.min : 1;
  const percent = Math.max(0, Math.min(100, Math.round((attended / goal) * 100)));
  return (
    <div className="profile-record-tier-track" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={attended}
      aria-label={nextTier ? `${attended} of ${goal} events toward ${nextTier.name}` : "Top tier reached"}>
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}
