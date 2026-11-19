"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { isMobileDevice, phantomBrowseLink } from "@/lib/phantom";
import bs58 from "bs58";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { claimMessage } from "@/lib/claimMessage";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";
import { NAME_MAX, cleanName } from "@/lib/memberName";
import { dateTile, formatDay, formatTime } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import type { EventRecord } from "@/lib/server/events";

type ClaimState = "ready" | "success" | "duplicate" | "expired";
type Busy = null | "signing" | "claiming";

export default function ClaimView({ event, code, clubName }: { event: EventRecord | null; code: string; clubName: string }) {
  const { connected, publicKey, signMessage, wallets, disconnect } = useWallet();
  // Email / Google sign-in with a wallet created behind the scenes (off unless PRIVY_APP_ID is set).
  const embedded = useEmbeddedWallet();
  // On a phone browser without a wallet (e.g. Safari after a camera scan), offer to reopen in Phantom.
  const [phantomLink, setPhantomLink] = useState("");
  useEffect(() => {
    if (isMobileDevice()) setPhantomLink(phantomBrowseLink(window.location.href, window.location.origin));
  }, []);
  const hasInstalledWallet = wallets.some((w) => w.readyState === WalletReadyState.Installed);
  const offerPhantom = !!phantomLink && !connected && !hasInstalledWallet;
  const { setVisible } = useWalletModal();
  const [claim, setClaim] = useState<ClaimState>(code ? "ready" : "expired");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [txSignature, setTxSignature] = useState("");
  const [claimedWallet, setClaimedWallet] = useState("");
  // Display name for the organizer's "Who's here" list: asked once per wallet, then remembered.
  const [name, setName] = useState("");
  const [nameKnown, setNameKnown] = useState<boolean | null>(null);
  const [editingName, setEditingName] = useState(false);
  // A connected Phantom wallet wins; otherwise the wallet that came with the email / Google sign-in.
  const usingEmbedded = !connected && !!embedded.address;
  const walletAddress = publicKey?.toBase58() ?? embedded.address ?? "";
  const hasWallet = !!walletAddress;
  // Signed in, but the wallet is still being created (takes a moment the first time).
  const settingUp = !connected && embedded.authenticated && !embedded.address;
  useEffect(() => {
    setNameKnown(null);
    setEditingName(false);
    if (!walletAddress) return;
    let cancelled = false;
    fetch(`/api/members/${walletAddress}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setNameKnown(d ? !!d.known : false); })
      .catch(() => { if (!cancelled) setNameKnown(false); });
    return () => { cancelled = true; };
  }, [walletAddress]);
  const askName = hasWallet && nameKnown !== null && (!nameKnown || editingName);

  // Tapping Claim without a wallet opens the sign-in or wallet picker. Once a wallet is
  // connected, carry on without a second tap (UI audit item 12). A first-time wallet still has
  // to type a name, so in that case the name field gets the focus instead.
  const [claimAfterConnect, setClaimAfterConnect] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const latestClaim = useRef<() => void>(() => {});
  useEffect(() => {
    if (!claimAfterConnect || !hasWallet || nameKnown === null || busy !== null) return;
    setClaimAfterConnect(false);
    if (nameKnown) latestClaim.current();
    else nameInput.current?.focus();
  }, [claimAfterConnect, hasWallet, nameKnown, busy]);

  if (!event) {
    return <><SiteHeader view="claim" /><main className="shell"><div className="center-page"><Link href="/" className="back-link">← Back to overview</Link><div className="claim-panel"><div className="large-symbol neutral-symbol"><Icon name="calendar" size={32}/></div><h1>We couldn’t find that event.</h1><p>Scan the QR code on the organizer’s screen to check in.</p></div></div></main><SiteFooter /></>;
  }

  async function doClaim() {
    if (!event) return;
    if (!hasWallet) {
      setClaimAfterConnect(true);
      if (embedded.enabled) embedded.login();
      else setVisible(true);
      return;
    }
    if (!usingEmbedded && !signMessage) { setError("This wallet can’t sign messages. Open this page in Phantom."); return; }
    const sign = usingEmbedded ? embedded.signMessage : signMessage!;
    const cleanedName = askName ? cleanName(name) : "";
    if (askName && !cleanedName) { setError("Add your name so your organizer knows you’re here."); return; }
    setError("");
    const wallet = walletAddress;
    try {
      // Step 1: the wallet signs a short message. This is free and sends nothing on-chain;
      // it just proves to the server that you own this wallet.
      setBusy("signing");
      let signature: string;
      try {
        const signed = await sign(new TextEncoder().encode(claimMessage(event.id, code, wallet)));
        signature = bs58.encode(signed);
      } catch {
        setError(usingEmbedded ? "We couldn’t confirm it’s you. Tap Claim to try again." : "Signature cancelled. Tap Claim to try again.");
        return;
      }

      // Step 2: the server checks the code + signature and mints your token.
      setBusy("claiming");
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, wallet, code, signature, name: cleanedName }),
      });
      const data = await res.json().catch(() => ({}));
      setClaimedWallet(wallet);
      if (cleanedName && (data.status === "success" || data.status === "already_claimed")) { setNameKnown(true); setEditingName(false); }
      if (data.status === "success") { setTxSignature(data.signature); setClaim("success"); return; }
      if (data.status === "already_claimed") { setClaim("duplicate"); return; }
      if (data.status === "expired") { setClaim("expired"); return; }
      switch (data.error) {
        case "name_required": setNameKnown(false); setError("Add your name so your organizer knows you’re here."); break;
        case "in_progress": setError("Your claim is already going through. Give it a few seconds."); break;
        case "bad_signature": setError("We couldn’t verify your wallet signature. Try again."); break;
        case "invalid_wallet": setError("That wallet address isn’t valid for claiming."); break;
        case "organizer_unfunded": setError("The organizer’s wallet is out of devnet SOL. Let them know."); break;
        default: setError("Couldn’t reach Solana devnet. Wait a moment and try again.");
      }
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  latestClaim.current = () => { void doClaim(); };

  const tile = dateTile(event.date);
  const profileHref = claimedWallet ? `/profile/${claimedWallet}` : "/profile/me";
  const buttonLabel = busy === "signing" ? (usingEmbedded ? "Confirming it’s you…" : "Approve in your wallet…") : busy === "claiming" ? "Claiming your attendance…" : hasWallet ? "Claim attendance" : settingUp ? "Setting up your account…" : embedded.enabled ? "Sign in to claim" : "Connect wallet to claim";
  // With sign-in on, Phantom stays available as a quieter second option.
  const phantomOption = embedded.enabled && !hasWallet && !settingUp && busy === null;
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : "";

  return <><SiteHeader view="claim" />
  <main className="shell"><div className="center-page"><Link href="/" className="back-link">← Back to overview</Link><div className="claim-panel" key={claim}><div className={`large-symbol${claim === "expired" ? " neutral-symbol" : ""}${claim === "success" ? " pop" : ""}`}><Icon name={claim === "success" || claim === "duplicate" ? "check" : "calendar"} size={32}/></div><Badge>{claim === "success" ? "Attendance confirmed" : clubName}</Badge><h1>{claim === "success" ? "You showed up." : claim === "duplicate" ? "Already part of the story." : claim === "expired" ? "Let’s try that again." : "Good to see you here."}</h1><p>{claim === "success" ? "A moment of your time. A permanent part of your story." : claim === "duplicate" ? "You’ve already claimed attendance for this event." : claim === "expired" ? "This code has expired. Scan the organizer’s latest QR code to check in." : "One tap to make this moment yours."}</p><div className="claim-event"><div className="date-tile"><small>{tile.month}</small>{tile.day}</div><div><h3>{event.name}</h3><p>{formatDay(event.date)} · {formatTime(event.date)}</p></div><Icon name="shield"/></div>
    {claim === "ready" && offerPhantom && !embedded.enabled && <><a className="button primary full" href={phantomLink}>Open in Phantom to claim<Icon name="wallet" size={17}/></a><small className="claim-note">Claiming works inside the Phantom app. No Phantom yet? This link takes you to the download.</small></>}
    {claim === "ready" && (!offerPhantom || embedded.enabled) && <>{askName && <label className="field claim-name">Your name<input ref={nameInput} type="text" placeholder="How your organizer will see you" autoComplete="name" maxLength={NAME_MAX} value={name} onChange={e=>setName(e.target.value)} disabled={busy !== null}/><small>{nameKnown ? "This replaces the name we have for this wallet." : "Only asked once. We’ll remember it for this wallet."}</small></label>}{hasWallet && nameKnown && !editingName && <p className="claim-name-known">Welcome back. <button type="button" className="text-link" onClick={()=>setEditingName(true)}>Change your name</button></p>}<button className="button primary full" onClick={doClaim} disabled={busy !== null || settingUp || (!hasWallet && embedded.enabled && !embedded.ready)}>{buttonLabel}<Icon name={hasWallet || embedded.enabled ? "arrow" : "wallet"} size={17}/></button>{error && <p className="form-error" role="alert">{error}</p>}<small className="claim-note">{busy === "signing" && !usingEmbedded ? "Signing is free and doesn’t send anything. It just proves this wallet is yours." : !hasWallet && embedded.enabled ? "Use your email or Google account. No app to install, no fees." : "No fees for you. Your organizer has it covered."}</small>{phantomOption && <p className="claim-name-known">Have a Phantom wallet? {offerPhantom ? <a className="text-link" href={phantomLink}>Open in Phantom</a> : <button type="button" className="text-link" onClick={()=>setVisible(true)}>Connect it instead</button>}</p>}{hasWallet && busy === null && <p className="claim-name-known">{usingEmbedded ? "Signed in" : "Connected"} · {shortWallet} <button type="button" className="text-link" onClick={()=>{ setError(""); if (usingEmbedded) void embedded.logout(); else void disconnect(); }}>{usingEmbedded ? "Sign out" : "Disconnect"}</button></p>}</>}
    {(claim === "success" || claim === "duplicate") && <><Link className="button primary full" href={profileHref}>View my attendance<Icon name="arrow" size={17}/></Link>{claim === "success" && txSignature && <a className="tx-link" href={explorerLink(txSignature, "tx")} target="_blank" rel="noreferrer"><Icon name="external" size={16}/>View transaction on Solana Explorer</a>}</>}
    {claim === "expired" && <Link className="button primary full" href="/">Back to overview<Icon name="arrow" size={17}/></Link>}
    <div className="soulbound-note"><Icon name="shield" size={15}/> Yours to keep. Nontransferable by design.</div></div></div></main><SiteFooter /></>;
}
