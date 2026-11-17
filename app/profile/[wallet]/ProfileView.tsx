"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { AttendanceCard } from "@/components/AttendanceCard";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TrackRecordGroups } from "@/components/TrackRecordGroups";
import { TrackRecordShare } from "@/components/TrackRecordShare";
import { TrackRecordUnverified } from "@/components/TrackRecordUnverified";
import { explorerLink } from "@/lib/solana";
import { fetchProfile, shortAddress, type Profile } from "@/lib/profileClient";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";

// "/profile/me" (and the older "/profile/demo" links) mean "whoever is connected".
const SELF_ALIASES = new Set(["me", "demo"]);
const TIERS = [{ n: 1, name: "Showed Up" }, { n: 3, name: "Regular" }, { n: 5, name: "Core Member" }];

export default function ProfileView({ walletParam }: { walletParam: string }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  // "Me" is a connected Phantom wallet, or the wallet that came with an email / Google sign-in.
  const embedded = useEmbeddedWallet();
  const connectedWallet = publicKey?.toBase58() ?? embedded.address ?? null;
  // Still finding out whether the visitor is signed in, or their wallet is being created.
  const signInPending = embedded.enabled && !publicKey && (!embedded.ready || (embedded.authenticated && !embedded.address));
  const isSelfRoute = SELF_ALIASES.has(walletParam);
  const target = isSelfRoute ? connectedWallet : walletParam;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<"" | "invalid_wallet" | "rpc_error" | "network">("");
  const [loading, setLoading] = useState(false);
  const [fillWidth, setFillWidth] = useState("0%");

  useEffect(() => {
    if (!target) { setProfile(null); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchProfile(target).then((r) => {
      if (cancelled) return;
      if (r.ok) setProfile(r.profile);
      else { setProfile(null); setError(r.error); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [target]);

  useEffect(() => {
    const pct = Math.min(profile?.count ?? 0, 5) / 5 * 100;
    const t = setTimeout(() => setFillWidth(`${pct}%`), 150);
    return () => clearTimeout(t);
  }, [profile?.count]);

  const shell = (body: ReactNode) => <><SiteHeader view="profile" /><main className="shell">{body}</main><SiteFooter /></>;
  const message = (symbol: string, title: string, text: string, action?: ReactNode) => shell(<div className="center-page"><div className="claim-panel"><div className="large-symbol"><Icon name={symbol} size={32}/></div><h1>{title}</h1><p>{text}</p>{action}</div></div>);

  if (isSelfRoute && !connectedWallet && signInPending) {
    return message("spark", "One moment…", "Checking whether you’re signed in.");
  }
  if (isSelfRoute && !connectedWallet && embedded.enabled) {
    return message("wallet", "Your presence, collected.", "Sign in to see the events you’ve shown up to.", <><button className="button primary full" style={{marginTop: 25}} onClick={() => embedded.login()}>Sign in <Icon name="arrow" size={17}/></button><p className="claim-name-known" style={{marginTop: 18}}>Have a Phantom wallet? <button type="button" className="text-link" onClick={() => setVisible(true)}>Connect it instead</button></p><Link className="text-link" href="/verify" style={{marginTop: 4}}>Or verify any wallet <Icon name="arrow" size={16}/></Link></>);
  }
  if (isSelfRoute && !connectedWallet) {
    return message("wallet", "Your presence, collected.", "Connect your wallet to see the events you’ve shown up to.", <><button className="button primary full" style={{marginTop: 25}} onClick={() => setVisible(true)}>Connect wallet <Icon name="wallet" size={17}/></button><Link className="text-link" href="/verify" style={{marginTop: 20}}>Or verify any wallet <Icon name="arrow" size={16}/></Link></>);
  }
  if (error === "invalid_wallet") {
    return message("shield", "That’s not a wallet address.", "Check the link, or look up a wallet on the Verify page.", <Link className="button primary full" style={{marginTop: 25}} href="/verify">Verify attendance <Icon name="arrow" size={16}/></Link>);
  }
  if (error) {
    return message("shield", "Couldn’t reach Solana devnet.", "Your attendance is safe on-chain. Refresh in a moment to try again.");
  }
  if (loading || !profile) {
    return message("spark", "Gathering the track record…", "Reading badges from Solana devnet.");
  }

  const count = profile.count;
  const isMine = profile.wallet === connectedWallet;
  const next = profile.nextTier;
  // Everything on the verified record: meetings attended plus contributions awarded by clubs.
  const total = profile.events.length;
  const contributions = profile.contributions;
  const clubCount = new Set(profile.events.map(e => e.club.id)).size;
  const tally = [
    count > 0 ? (count === 1 ? "One meeting" : `${count} meetings`) : "",
    contributions > 0 ? (contributions === 1 ? "one contribution" : `${contributions} contributions`) : "",
  ].filter(Boolean).join(" and ");
  const intro = total === 0
    ? "No badges yet. Your first one is a scan away."
    : `${tally.charAt(0).toUpperCase()}${tally.slice(1)} across ${clubCount === 1 ? "one club" : `${clubCount} clubs`}. Each one issued by a verified club, and yours to keep.`;
  const heading = count >= 5 ? "That’s what makes you core." : count === 0 ? "Your first event is waiting." : "Good things come from coming back.";
  const body = count >= 5
    ? "You’ve reached Core Member. It’s a reflection of the time you’ve put in, and the community you’re building."
    : next
      ? `${count === 0 ? "No events yet." : `${count} ${count === 1 ? "event" : "events"} collected.`} Just ${next.remaining} more to unlock ${next.name}. Every appearance counts.`
      : "";

  return shell(<>
    <div className="page-intro profile-heading"><div><Badge>{isMine ? "Your track record" : "Track record, on-chain"}</Badge><h1>{total === 0 ? "Every story starts somewhere." : "A little more connected."}</h1><p>{intro}</p></div><span className="profile-avatar">{profile.wallet.slice(0, 2).toUpperCase()}</span></div>
    <div className="profile-layout"><div><AttendanceCard small count={count}/><div className="wallet-detail"><Icon name="wallet" size={15}/><span>{shortAddress(profile.wallet)} · {isMine ? "Your wallet" : "Viewed wallet"}</span><a href={explorerLink(profile.wallet)} target="_blank" rel="noreferrer">View on Explorer <Icon name="external" size={14}/></a></div></div>
      <div className="panel membership"><span className="eyebrow">YOU KEEP SHOWING UP</span><h2>{heading}</h2><p>{body}</p><div className="tier-line"><div className="tier-fill" style={{width: fillWidth}}/>{TIERS.map(t => <span key={t.n} className={`tier-point ${count >= t.n ? "done" : "pending"}`}>{count >= t.n ? "✓" : t.n}<small>{t.name}<b>{t.n} {t.n === 1 ? "event" : "events"}</b></small></span>)}</div><div className="perk"><Icon name="spark"/><div><strong>A little extra, for showing up.</strong><p>Sample perks: priority workshop access, member recognition, and partner offers.</p></div><span className="quiet-pill">{count >= 5 ? "Unlocked" : "At 5 events"}</span></div></div></div>
    <div className="section-heading history-heading"><div><span className="eyebrow">A RECORD OF BEING THERE</span><h2>{isMine ? "Your track record" : "Track record"}</h2></div><div className="history-actions"><span className="muted">{total} {total === 1 ? "badge" : "badges"}</span><Link className="pill-link" href="/verify"><Icon name="shield" size={14}/> Verify a wallet</Link></div></div>
    {profile.partial && <p className="tr-note tr-partial">Some badges may be missing: part of the service couldn’t be reached. Refresh in a moment to try again.</p>}
    {total === 0
      ? <div className="panel history"><div className="event-row"><div className="event-info"><h3>Nothing here yet.</h3><p>Scan the QR code at your next meeting and tap Claim.</p></div></div></div>
      : <TrackRecordGroups events={profile.events}/>}
    <TrackRecordUnverified badges={profile.unverified ?? []} total={profile.unverifiedTotal ?? 0}/>
    <TrackRecordShare wallet={profile.wallet} isMine={isMine}/>
  </>);
}
