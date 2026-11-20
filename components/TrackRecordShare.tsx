"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "./Icon";

/** Copies text without the Clipboard API: selects it in a hidden field and asks the browser to copy. */
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(field);
  return ok;
}

/** Share section: the public link to this track record, a copy button and a QR code of the link. */
export function TrackRecordShare({ wallet, isMine }: { wallet: string; isMine: boolean }) {
  // window isn't available during server render, so the origin is read after mount.
  const [origin, setOrigin] = useState("");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const url = origin ? `${origin}/profile/${wallet}` : "";

  async function copy() {
    if (!url) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // No clipboard permission (or an older browser): try the older way before giving up.
      ok = legacyCopy(url);
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  // The phone's own share sheet (Messages, LinkedIn, …) where the browser has one.
  const [canShare, setCanShare] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  async function share() {
    if (!url) return;
    try { await navigator.share({ title: "My ShowedUp track record", text: "My verified track record from student clubs, on Solana.", url }); }
    catch { /* closed the share sheet: nothing to do */ }
  }

  return (
    <section className="panel tr-share tr-share-v2">
      <div className="tr-share-row">
        <div className="tr-share-copy">
          <h2>{isMine ? "Share your track record" : "Share this track record"}</h2>
          <p>Anyone with the link sees the same public badges. To show a private contribution, share its downloaded receipt.{isMine ? " Your profile shows only if you switched it on." : ""}</p>
        </div>
        <div className="tr-share-actions">
          {canShare && <button type="button" className="button primary" onClick={share} disabled={!url}>Share <Icon name="arrow" size={15}/></button>}
          <button type="button" className={`button ${canShare ? "secondary" : "primary"}`} onClick={copy} disabled={!url}>{state === "copied" ? "Copied" : "Copy link"} <Icon name={state === "copied" ? "check" : "external"} size={15}/></button>
          <button type="button" className="button secondary" aria-expanded={showQr} onClick={() => setShowQr(!showQr)}>{showQr ? "Hide QR" : "Show QR"}</button>
        </div>
      </div>
      <span className="tr-share-status" role="status">{state === "failed" ? `Couldn’t copy automatically. The link is ${url}` : ""}</span>
      {showQr && url && <div className="qr-wrap tr-qr"><QRCodeSVG value={url} size={180} fgColor="#0d1f78" level="M" marginSize={1} title="QR code linking to this track record"/></div>}
    </section>
  );
}
