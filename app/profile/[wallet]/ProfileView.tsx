"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Icon } from "@/components/Icon";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TrackRecordShare } from "@/components/TrackRecordShare";
import { TrackRecordUnverified } from "@/components/TrackRecordUnverified";
import { fetchProfile, type ProfileResult } from "@/lib/profileClient";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";
import { ProfileRecord } from "./ProfileRecord";

// "/profile/me" (and the older "/profile/demo" links) mean "whoever is connected".
const SELF_ALIASES = new Set(["me", "demo"]);

export default function ProfileView({ walletParam }: { walletParam: string }) {
  const { publicKey, wallet, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  // "Me" is a connected Phantom wallet, or the wallet that came with an email / Google sign-in.
  const embedded = useEmbeddedWallet();
  const connectedWallet = publicKey?.toBase58() ?? embedded.address ?? null;
  // Still finding out whether the visitor is signed in, or their wallet is being created.
  const signInPending = embedded.enabled && !publicKey && (!embedded.ready || (embedded.authenticated && !embedded.address));
  // Phantom reconnects on its own a moment after the page loads (autoConnect). Until it has had
  // that moment, don't tell a returning user to "connect your wallet". The remembered wallet is
  // only read after the first render, so give everyone a short grace period, and a longer one
  // when a wallet was remembered.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGraceOver(true), wallet ? 4000 : 800);
    return () => window.clearTimeout(timer);
  }, [wallet]);
  const walletRestoring = !publicKey && (connecting || !graceOver);
  const isSelfRoute = SELF_ALIASES.has(walletParam);
  const target = isSelfRoute ? connectedWallet : walletParam;

  const [loaded, setLoaded] = useState<{ wallet: string; result: ProfileResult } | null>(null);
  const result = loaded?.wallet === target ? loaded?.result : undefined;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    fetchProfile(target).then((result) => {
      if (!cancelled) setLoaded({ wallet: target, result });
    });
    return () => { cancelled = true; };
  }, [target]);

  const shell = (body: ReactNode, extra = "") => <><SiteHeader view="profile" /><main className={`shell${extra}`}>{body}</main><SiteFooter /></>;
  // Sign-in, loading and error screens use the same card as the claim page.
  const message = (symbol: string, title: string, text: string, action?: ReactNode) => shell(<div className="center-page"><div className="claim-panel"><div className="large-symbol"><Icon name={symbol} size={32}/></div><h1>{title}</h1><p>{text}</p>{action}</div></div>, " claim-v2");

  if (isSelfRoute && !connectedWallet && (signInPending || walletRestoring)) {
    return message("spark", "One moment…", "Looking for your wallet.");
  }
  if (isSelfRoute && !connectedWallet && embedded.enabled) {
    return message("wallet", "Your presence, collected.", "Sign in to see the events you’ve shown up to.", <><button className="button primary full" style={{marginTop: 25}} onClick={() => embedded.login()}>Sign in <Icon name="arrow" size={17}/></button><p className="claim-name-known" style={{marginTop: 18}}>Have a Phantom wallet? <button type="button" className="text-link" onClick={() => setVisible(true)}>Connect it instead</button></p><Link className="text-link" href="/verify" style={{marginTop: 4}}>Or verify any wallet <Icon name="arrow" size={16}/></Link></>);
  }
  if (isSelfRoute && !connectedWallet) {
    return message("wallet", "Your presence, collected.", "Connect your wallet to see the events you’ve shown up to.", <><button className="button primary full" style={{marginTop: 25}} onClick={() => setVisible(true)}>Connect wallet <Icon name="wallet" size={17}/></button><Link className="text-link" href="/verify" style={{marginTop: 20}}>Or verify any wallet <Icon name="arrow" size={16}/></Link></>);
  }
  if (!result) {
    return message("spark", "Gathering the track record…", "Reading badges from Solana devnet.");
  }
  if (!result.ok && result.error === "invalid_wallet") {
    return message("shield", "That’s not a wallet address.", "Check the link, or look up a wallet on the Verify page.", <Link className="button primary full" style={{marginTop: 25}} href="/verify">Verify attendance <Icon name="arrow" size={16}/></Link>);
  }
  if (!result.ok) {
    return message("shield", "Couldn’t reach Solana devnet.", "Your attendance is safe on-chain. Refresh in a moment to try again.");
  }
  const { profile } = result;
  const isMine = profile.wallet === connectedWallet;
  return shell(<>
    <ProfileRecord key={profile.wallet} profile={profile} isMine={isMine} />
    <TrackRecordUnverified badges={profile.unverified ?? []} total={profile.unverifiedTotal ?? 0}/>
    <TrackRecordShare wallet={profile.wallet} isMine={isMine}/>
  </>);
}
