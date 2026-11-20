"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import bs58 from "bs58";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { isMobileDevice, phantomBrowseLink } from "@/lib/phantom";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";
import { NAME_MAX, cleanName } from "@/lib/memberName";
import { formatDay } from "@/lib/format";
import { explorerLink } from "@/lib/solana";
import { signedRead } from "@/lib/privateAccess";
import { applyMessage, formatClosingDay, ruleSentence, type ApplicationStatus, type OpeningInfo, type RuleCheck } from "@/lib/openings";

type Busy = null | "checking" | "signing" | "applying";
type Outcome = null | { kind: "applied" } | { kind: "already"; status: ApplicationStatus };

const STATUS_LINE: Record<ApplicationStatus, string> = {
  pending: "It’s with the club’s officers. No decision yet.",
  accepted: "The club accepted your application.",
  declined: "The club isn’t taking this application forward. Your track record is unchanged.",
};

export default function OpeningView({ opening }: { opening: OpeningInfo | null }) {
  const { publicKey } = useWallet();
  const embedded = useEmbeddedWallet();
  // Unmount private results immediately on an account switch, including requests still in flight.
  return <OpeningForWallet key={`${opening?.id}/${publicKey?.toBase58() ?? embedded.address ?? ""}`} opening={opening}/>;
}

function OpeningForWallet({ opening }: { opening: OpeningInfo | null }) {
  const { connected, publicKey, signMessage, wallets, disconnect } = useWallet();
  // Email / Google sign-in with a wallet created behind the scenes (off unless PRIVY_APP_ID is set).
  const embedded = useEmbeddedWallet();
  const { setVisible } = useWalletModal();
  // On a phone browser without a wallet, offer to reopen this page inside Phantom.
  const [phantomLink, setPhantomLink] = useState("");
  // The closing date is shown in the reader's own timezone, so it is filled in after the page loads.
  const [closesLabel, setClosesLabel] = useState("");
  const closesAt = opening?.closesAt ?? null;
  useEffect(() => {
    if (isMobileDevice()) setPhantomLink(phantomBrowseLink(window.location.href, window.location.origin));
    setClosesLabel(closesAt ? formatClosingDay(closesAt) : "");
  }, [closesAt]);
  const hasInstalledWallet = wallets.some((w) => w.readyState === WalletReadyState.Installed);
  const offerPhantom = !!phantomLink && !connected && !hasInstalledWallet;

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [check, setCheck] = useState<RuleCheck | null>(null);
  const [closed, setClosed] = useState(opening?.closed ?? false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The name the club's officers will see: asked for here only if this wallet has none saved yet.
  const [name, setName] = useState("");
  const [nameKnown, setNameKnown] = useState<boolean | null>(null);

  // A connected Phantom wallet wins; otherwise the wallet that came with the email / Google sign-in.
  const usingEmbedded = !connected && !!embedded.address;
  const walletAddress = publicKey?.toBase58() ?? embedded.address ?? "";
  const hasWallet = !!walletAddress;
  // Signed in, but the wallet is still being created (takes a moment the first time).
  const settingUp = !connected && embedded.authenticated && !embedded.address;

  // A different wallet means a different track record: start over.
  useEffect(() => {
    setCheck(null);
    setOutcome(null);
    setError("");
    setNameKnown(null);
    if (!walletAddress) return;
    let cancelled = false;
    fetch(`/api/members/${walletAddress}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setNameKnown(d ? !!d.known : false); })
      .catch(() => { if (!cancelled) setNameKnown(false); });
    return () => { cancelled = true; };
  }, [walletAddress]);

  if (!opening) {
    return <><SiteHeader view="claim" /><main className="shell"><div className="center-page"><Link href="/" className="back-link">← Back to overview</Link><div className="claim-panel"><div className="large-symbol neutral-symbol"><Icon name="people" size={32}/></div><h1>We couldn’t find that opening.</h1><p>Check the link, or head back to the overview to see what’s open right now.</p></div></div></main><SiteFooter /></>;
  }
  const o = opening;

  function connect() {
    if (embedded.enabled) embedded.login();
    else setVisible(true);
  }

  // Asks the server whether this wallet meets the rule. The server reads the wallet's badges
  // from Solana itself; the browser only shows the answer.
  async function doCheck() {
    if (!hasWallet) { connect(); return; }
    setError("");
    setBusy("checking");
    try {
      const sign = usingEmbedded ? embedded.signMessage : signMessage;
      if (!sign) { setError("Connect a wallet that supports message signing."); return; }
      const res = await signedRead(`/api/openings/${o.id}/check`, `opening/${o.id}`, walletAddress, sign);
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setCheck(data as RuleCheck); setClosed(!!data.closed); return; }
      switch (data.error) {
        case "invalid_wallet": setError("That wallet address can’t hold a track record."); break;
        case "not_found": setError("This opening is no longer available."); break;
        case "rpc_error": setError("Couldn’t reach Solana devnet. Wait a moment and try again."); break;
        default: setError("Something went wrong on our side. Try again in a moment.");
      }
    } catch {
      setError("Couldn’t check your record. Approve the wallet signature and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function doApply() {
    if (!hasWallet) { connect(); return; }
    if (!usingEmbedded && !signMessage) { setError("This wallet can’t sign messages. Open this page in Phantom."); return; }
    const sign = usingEmbedded ? embedded.signMessage : signMessage!;
    const askName = nameKnown === false;
    const cleanedName = askName ? cleanName(name) : "";
    if (askName && !cleanedName) { setError("Add your name so the club’s officers know who is applying."); return; }
    setError("");
    const wallet = walletAddress;
    try {
      // Step 1: the wallet signs a short message. This is free and sends nothing on-chain;
      // it just proves to the server that you own this wallet.
      setBusy("signing");
      let signature: string;
      try {
        const signed = await sign(new TextEncoder().encode(applyMessage(o.id, wallet)));
        signature = bs58.encode(signed);
      } catch {
        setError(usingEmbedded ? "We couldn’t confirm it’s you. Tap Apply to try again." : "Signature cancelled. Nothing was sent. Tap Apply to try again.");
        return;
      }

      // Step 2: the server checks the signature, checks the rule again from Solana, and only
      // then saves the application.
      setBusy("applying");
      const res = await fetch(`/api/openings/${o.id}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, signature, name: cleanedName }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === "applied") { if (cleanedName) setNameKnown(true); setOutcome({ kind: "applied" }); return; }
      if (data.status === "already_applied") {
        const status: ApplicationStatus = data.application === "accepted" || data.application === "declined" ? data.application : "pending";
        setOutcome({ kind: "already", status });
        return;
      }
      if (data.status === "closed") { setClosed(true); return; }
      if (data.status === "not_qualified") {
        setCheck({ qualifies: false, counted: Number(data.counted) || 0, needed: Number(data.needed) || o.minCount, remaining: Number(data.remaining) || 0, badges: [] });
        setError("Your track record no longer meets this rule, so nothing was sent.");
        return;
      }
      switch (data.error) {
        case "name_required": setNameKnown(false); setError("Add your name so the club’s officers know who is applying."); break;
        case "bad_signature": setError("We couldn’t verify your wallet signature. Try again."); break;
        case "invalid_wallet": setError("That wallet address can’t be used to apply."); break;
        case "not_found": setError("This opening is no longer available."); break;
        case "rpc_error": setError("Couldn’t reach Solana devnet. Wait a moment and try again."); break;
        default: setError("We couldn’t save your application. Try again in a moment.");
      }
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const rule = ruleSentence(o.role, o.minCount);
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : "";
  const roleWord = o.role ? `${o.role} ` : "";
  const checkLabel = busy === "checking" ? "Reading your track record…" : hasWallet ? (check ? "Check again" : "Check if I qualify") : settingUp ? "Setting up your account…" : embedded.enabled ? "Sign in to check" : "Connect wallet to check";
  const applyLabel = busy === "signing" ? (usingEmbedded ? "Confirming it’s you…" : "Approve in your wallet…") : busy === "applying" ? "Sending your application…" : "Apply with my track record";
  // With sign-in on, Phantom stays available as a quieter second option.
  const phantomOption = embedded.enabled && !hasWallet && !settingUp && busy === null;
  const canApply = !!check?.qualifies && !closed && !outcome;
  const done = outcome?.kind === "applied" || (outcome?.kind === "already" && outcome.status !== "declined");

  return <><SiteHeader view="claim" />
  <main className="shell"><div className="center-page"><Link href="/" className="back-link">← Back to overview</Link><div className="claim-panel opening-panel"><div className={`large-symbol${closed && !outcome ? " neutral-symbol" : ""}${outcome?.kind === "applied" ? " pop" : ""}`}><Icon name={done ? "check" : "people"} size={32}/></div><Badge>{o.clubName}</Badge><h1>{o.title}</h1>{o.description && <p className="opening-description">{o.description}</p>}
    <div className="opening-rule"><span className="eyebrow">WHO CAN APPLY</span><strong>{rule}</strong><small>Badges from every verified club count together. Signed contribution receipts and legacy token badges count.{closed ? " This opening has closed." : closesLabel ? ` Open until ${closesLabel}.` : ""}</small></div>

    {!outcome && <>
      {offerPhantom && !embedded.enabled
        ? <><a className="button primary full" href={phantomLink}>Open in Phantom to check<Icon name="wallet" size={17}/></a><small className="claim-note">Checking works inside the Phantom app. No Phantom yet? This link takes you to the download.</small></>
        : !canApply && <button className={`button ${check ? "secondary" : "primary"} full`} onClick={doCheck} disabled={busy !== null || settingUp || (!hasWallet && embedded.enabled && !embedded.ready)}>{checkLabel}<Icon name={hasWallet || embedded.enabled ? "arrow" : "wallet"} size={17}/></button>}

      {check && <div className={`opening-result${check.qualifies ? "" : " short"}`} role="status"><Icon name={check.qualifies ? "check" : "spark"} size={20}/><div><strong>{check.qualifies ? "You qualify." : "Not there yet."}</strong><p>{check.qualifies
        ? `${check.counted} of your verified ${roleWord}${check.counted === 1 ? "badge counts" : "badges count"} toward this rule (${check.needed} needed).`
        : `You have ${check.counted} of the ${check.needed} ${roleWord}${check.needed === 1 ? "badge" : "badges"} this opening asks for. ${check.remaining} more from a verified club and you’re in.`}</p>{check.partial && <p>We couldn’t read every club just now, so some badges may be missing. Try again in a moment.</p>}</div></div>}

      {check && check.badges.length > 0 && <ul className="opening-badges" aria-label="Badges that counted">{check.badges.map((b) => <li key={b.receiptFile?.receipt.signature ?? b.mint}><span className="history-check"><Icon name="shield" size={16}/></span><div><strong>{b.name}</strong><small>{b.club} · {b.role} · {formatDay(b.date)}</small></div><a className="icon-link" href={b.receiptFile ? explorerLink(b.receiptFile.receipt.signature, "tx") : explorerLink(b.mint!)} target="_blank" rel="noreferrer" aria-label={`View ${b.name} on Solana Explorer`} title="View on Solana Explorer"><Icon name="external" size={16}/></a></li>)}</ul>}
      {check && check.counted > check.badges.length && check.badges.length > 0 && <small className="claim-note">Showing the newest {check.badges.length} of {check.counted}.</small>}

      {check?.qualifies && closed && <p className="opening-consent">This opening has closed, so it isn’t taking applications any more.</p>}

      {canApply && <>
        <p className="opening-consent"><strong>Before you apply:</strong> applying shares your saved name and the matching badges and contribution receipts with {o.clubName}’s officers, so they can decide. Nobody else sees your name. It is never shown on a public page and never written to Solana.</p>
        {nameKnown === false && <label className="field claim-name">Your name<input type="text" placeholder="How the club’s officers will see you" autoComplete="name" maxLength={NAME_MAX} value={name} onChange={e=>setName(e.target.value)} disabled={busy !== null}/><small>We don’t have a name for this wallet yet. It’s saved only once you apply.</small></label>}
        <button className="button primary full" onClick={doApply} disabled={busy !== null || nameKnown === null}>{applyLabel}<Icon name="arrow" size={17}/></button>
        <small className="claim-note">{busy === "signing" && !usingEmbedded ? "Signing is free and doesn’t send anything. It just proves this wallet is yours." : "You’ll confirm with your wallet. It’s free. Already applied? Applying again just shows where your application stands."}</small>
        <p className="claim-name-known"><button type="button" className="text-link" onClick={doCheck} disabled={busy !== null}>Check again</button></p>
      </>}

      {error && <p className="form-error" role="alert">{error}</p>}
      {!hasWallet && !offerPhantom && <small className="claim-note">{embedded.enabled ? "Use your email or Google account. No app to install, no fees." : "Connect the wallet that holds your badges. Checking is free."}</small>}
      {phantomOption && <p className="claim-name-known">Have a Phantom wallet? {offerPhantom ? <a className="text-link" href={phantomLink}>Open in Phantom</a> : <button type="button" className="text-link" onClick={()=>setVisible(true)}>Connect it instead</button>}</p>}
      {hasWallet && busy === null && <p className="claim-name-known">{usingEmbedded ? "Signed in" : "Connected"} · {shortWallet} <button type="button" className="text-link" onClick={()=>{ setError(""); if (usingEmbedded) void embedded.logout(); else void disconnect(); }}>{usingEmbedded ? "Sign out" : "Disconnect"}</button></p>}
    </>}

    {outcome && <>
      <div className="opening-result" role="status"><Icon name={done ? "check" : "spark"} size={20}/><div><strong>{outcome.kind === "applied" ? "Application sent." : "You’ve already applied."}</strong><p>{outcome.kind === "applied" ? `${o.clubName}’s officers can now see your name and the badges that counted. Come back to this page and apply again any time to see where it stands.` : STATUS_LINE[outcome.status]}</p></div></div>
      <Link className="button primary full" href={`/profile/${walletAddress || "me"}`}>View my track record<Icon name="arrow" size={17}/></Link>
    </>}
    <div className="soulbound-note"><Icon name="shield" size={15}/> Your track record is yours. Positive records only.</div></div></div></main><SiteFooter /></>;
}
