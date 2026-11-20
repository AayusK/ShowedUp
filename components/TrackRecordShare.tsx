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

  return (
    <section className="panel tr-share">
      <div className="tr-share-copy">
        <span className="eyebrow">SHARE IT</span>
        <h2>{isMine ? "Take your track record with you." : "Pass this track record along."}</h2>
        <p>{isMine ? "Send this link to another club, or let them scan the code." : "Anyone with this link sees the same record."} It shows verified badges and a wallet address, never a name.</p>
        <input className="tr-share-link" readOnly value={url} placeholder="Getting the link…" aria-label="Link to this track record" onFocus={(e) => e.currentTarget.select()}/>
        <div className="tr-share-actions">
          <button type="button" className="button primary" onClick={copy} disabled={!url}>{state === "copied" ? "Copied" : "Copy link"} <Icon name={state === "copied" ? "check" : "arrow"} size={16}/></button>
          <span className="tr-share-status" role="status">{state === "failed" ? "Couldn’t copy automatically. Select the link above and copy it." : ""}</span>
        </div>
      </div>
      <div className="qr-wrap tr-qr">{url
        ? <QRCodeSVG value={url} size={160} fgColor="#0d1f78" level="M" marginSize={1} title="QR code linking to this track record"/>
        : <div style={{aspectRatio: "1"}}/>}</div>
    </section>
  );
}
