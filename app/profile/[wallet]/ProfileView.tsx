"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
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
  // Phantom reconnects on its own after a page load (autoConnect), but not instantly. If a wallet
  // was used before and is available, give it a moment instead of flashing "Connect your wallet".
  // The 2 s cap means a reconnect that never happens can't leave the page stuck on "One moment…".
  const [reconnectGrace, setReconnectGrace] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setReconnectGrace(false), 2000);
    return () => clearTimeout(t);
  }, []);
  const walletAvailable = wallet?.readyState === WalletReadyState.Installed || wallet?.readyState === WalletReadyState.Loadable;
  const phantomPending = !publicKey && (connecting || (reconnectGrace && walletAvailable));
  // Still finding out whether the visitor is signed in, or their wallet is being created.
  const signInPending = phantomPending || (embedded.enabled && !publicKey && (!embedded.ready || (embedded.authenticated && !embedded.address)));
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
