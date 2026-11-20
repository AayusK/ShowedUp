"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { shortAddress, type Profile, type ProfileEvent } from "@/lib/profileClient";
import { explorerLink } from "@/lib/solana";
import { CONTRIBUTION_ROLES } from "@/lib/badges";
import { formatDay } from "@/lib/format";
import { groupTrackRecord, roleCounts } from "@/lib/trackRecord";
import { TIERS } from "@/lib/tiers";

function eventCount(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

/**
 * How far this wallet is along the tiers (1 = Showed Up, 3 = Regular, 5 = Core Member), as a
 * bar with one stop per tier. Counts attendance only, like the tiers themselves.
 */
function TierProgress({ profile }: { profile: Profile }) {
  const top = TIERS[TIERS.length - 1].min;
  const fill = Math.min(profile.count, top) / top;
  return (
    <div className="profile-record-tier">
      <div className="tier-progress-head">
        <span>{eventCount(profile.count)} attended</span>
        <span>{profile.nextTier ? `${eventCount(profile.nextTier.remaining)} to ${profile.nextTier.name}` : "Top tier reached"}</span>
      </div>
      <div className="tier-progress" role="progressbar" aria-valuemin={0} aria-valuemax={top} aria-valuenow={Math.min(profile.count, top)} aria-label={`${eventCount(profile.count)} attended`}>
        <div className="tier-progress-fill" style={{ width: `${fill * 100}%` }} />
        {TIERS.map((t) => <span key={t.name} className={`tier-progress-stop${profile.count >= t.min ? " reached" : ""}`} style={{ left: `${(t.min / top) * 100}%` }} />)}
      </div>
      <div className="tier-progress-labels">
        {TIERS.map((t) => <span key={t.name} className={profile.count >= t.min ? "reached" : ""} style={{ left: `${(t.min / top) * 100}%` }}>{t.name}</span>)}
      </div>
    </div>
  );
}

/** A role pill in that role's colour: "Mentor", "Speaker", ... or "Attended" for attendance. */
function RolePill({ event }: { event: ProfileEvent }) {
  const role = event.kind === "attendance" ? "Attendee" : event.role;
  return <span className={`rec-pill rec-role-${role}`}>{role === "Attendee" ? "Attended" : role}</span>;
}

function CopyWallet({ wallet }: { wallet: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(wallet); } catch { return; }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }
  return <button type="button" className="rec-copy" onClick={copy} aria-label="Copy wallet address">{copied ? <><Icon name="check" size={13} /> Copied</> : "Copy"}</button>;
}

/**
 * "Regular unlocked": shown once, on your own record, the first time this browser sees you at a
 * new tier. Remembered in this browser only (a convenience; nothing is saved on the server).
 */
function useTierUnlock(wallet: string, tier: string | null, isMine: boolean): string | null {
  const [unlocked, setUnlocked] = useState<string | null>(null);
  useEffect(() => {
    if (!isMine || !tier) return;
    const key = `showedup-tier-seen:${wallet}`;
    let seen: string | null = null;
    try { seen = localStorage.getItem(key); } catch { return; }
    // The very first visit just records the tier: no banner for a tier you already had.
    if (seen !== null && seen !== tier) setUnlocked(tier);
    try { localStorage.setItem(key, tier); } catch {}
  }, [wallet, tier, isMine]);
  return unlocked;
}

/**
 * The track record in one strip, shown inside the profile header: tier, wallet, a slim progress
 * bar toward the next tier, and the counts. Replaces the big blue tier card.
 */
export function RecordSummary({ profile }: { profile: Profile }) {
  const clubs = new Set(profile.events.map((e) => e.club.id)).size;
  return (
    <div className="rs">
      <div className="rs-top">
        <span className="rs-tier">{profile.tier ?? "No tier yet"}</span>
        <span className="rs-verified"><Icon name="shield" size={13} /> Verified on Solana</span>
        <span className="rs-wallet">
          <a href={explorerLink(profile.wallet)} target="_blank" rel="noreferrer" aria-label={`View wallet ${profile.wallet} on Solana Explorer`}>{shortAddress(profile.wallet)} <Icon name="external" size={12} /></a>
          <CopyWallet wallet={profile.wallet} />
        </span>
      </div>
      <TierProgress profile={profile} />
      <div className="rs-stats">
        <span><strong>{profile.count}</strong> {profile.count === 1 ? "event" : "events"}</span>
        <span><strong>{profile.contributions}</strong> {profile.contributions === 1 ? "contribution" : "contributions"}</span>
        <span><strong>{clubs}</strong> {clubs === 1 ? "club" : "clubs"}</span>
      </div>
    </div>
  );
}

export function ProfileRecord({ profile, isMine }: { profile: Profile; isMine: boolean }) {
  const unlocked = useTierUnlock(profile.wallet, profile.tier, isMine);
  const clubs = groupTrackRecord(profile.events);
  const contributions = profile.events
    .filter((e) => e.kind === "contribution")
    .sort((a, b) => b.date.localeCompare(a.date));
  // "2 × Mentor · 1 × Speaker", in the fixed role order.
  const roleTotals = CONTRIBUTION_ROLES
    .map((role) => ({ role, n: contributions.filter((e) => e.role === role).length }))
    .filter((r) => r.n > 0);

  return (
    <div className="rec">
      {unlocked && <p className="rec-unlock" role="status"><Icon name="spark" size={18}/><span><strong>{unlocked} unlocked.</strong> Keep showing up.</span></p>}

      {profile.partial && <p className="rec-notice" role="status">Some badges may be missing right now. Refresh to try again.</p>}

      {contributions.length > 0 && (
        <section className="rec-section">
          <div className="rec-section-head">
            <h2>Contributions</h2>
            <div className="rec-totals">{roleTotals.map(({ role, n }) => <span key={role} className={`rec-pill rec-role-${role}`}>{n} × {role}</span>)}</div>
          </div>
          <ul className="rec-contribs">
            {contributions.map((e) => (
              <li key={e.mint} className={`rec-contrib rec-edge-${e.role}`}>
                <RolePill event={e} />
                <strong>{e.name}</strong>
                <span>{e.club.name} · {formatDay(e.date)}</span>
                <a href={explorerLink(e.mint)} target="_blank" rel="noreferrer" aria-label={`View ${e.name} badge on Solana Explorer`}>Solana <Icon name="external" size={12} /></a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rec-section">
        <div className="rec-section-head"><h2>Clubs</h2></div>
        {clubs.length === 0 && <p className="rec-notice">No verified badges yet. Scan a club’s check-in QR code to get your first one.</p>}
        {clubs.map(({ club, terms }) => (
          <div className="rec-club" key={club.id}>
            <div className="rec-club-head">
              <span className="rec-club-mark" aria-hidden="true">{Array.from(club.name)[0]?.toUpperCase()}</span>
              <div>
                <strong>{club.name}</strong>
                <span>{roleCounts(terms.flatMap((t) => t.events)).join(" · ")}</span>
              </div>
              {isMine && <Link className="rec-chat" href={`/chat/${club.id}`}><Icon name="chat" size={13} /> Club chat</Link>}
              <a href={explorerLink(club.issuer)} target="_blank" rel="noreferrer" aria-label={`View ${club.name}’s issuer wallet on Solana Explorer`}>Issuer <Icon name="external" size={12} /></a>
            </div>
            {terms.map((term) => (
              <div className="rec-term" key={term.label}>
                <h3>{term.label}</h3>
                <ul>
                  {term.events.map((e) => (
                    <li key={e.mint}>
                      <RolePill event={e} />
                      <strong>{e.name}</strong>
                      <span className="rec-date">{formatDay(e.date)}</span>
                      <a href={explorerLink(e.mint)} target="_blank" rel="noreferrer" aria-label={`View ${e.name} badge on Solana Explorer`}><Icon name="external" size={14} /></a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </section>

      <p className="rec-verify"><Link href="/verify"><Icon name="shield" size={14} /> Look up another wallet</Link></p>
    </div>
  );
}
