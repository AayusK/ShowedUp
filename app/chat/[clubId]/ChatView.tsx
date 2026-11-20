"use client";

import { useEffect, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Icon } from "@/components/Icon";
import { SiteHeader } from "@/components/SiteHeader";
import { ChatPanel } from "@/components/ChatPanel";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";
import { chatSignInMessage } from "@/lib/chat";
import type { ClubInfo } from "@/lib/clubs";

/**
 * A member's club chat. They prove their wallet once with a free signature; the 7-day chat token
 * is kept in this browser. Only people who checked in to the club themselves get in.
 */
export default function ChatView({ clubId }: { clubId: string }) {
  const { publicKey, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const embedded = useEmbeddedWallet();
  const wallet = publicKey?.toBase58() ?? embedded.address ?? null;
  const key = wallet ? `showedup-chat:${clubId}:${wallet}` : null;

  const [club, setClub] = useState<ClubInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/clubs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d: { clubs?: ClubInfo[] } | null) => setClub(d?.clubs?.find((c) => c.id === clubId) ?? null)).catch(() => {});
  }, [clubId]);

  // A saved token for this wallet and club, if it hasn't expired.
  useEffect(() => {
    setToken(null);
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { token: string; expiresAt: string } | null;
      if (saved && Date.parse(saved.expiresAt) > Date.now() + 60_000) setToken(saved.token);
    } catch {}
  }, [key]);

  async function signIn() {
    if (!wallet) { if (embedded.enabled) embedded.login(); else setVisible(true); return; }
    setBusy(true); setError("");
    try {
      const signedAt = new Date().toISOString();
      const bytes = new TextEncoder().encode(chatSignInMessage(clubId, wallet, signedAt));
      const sig = publicKey?.toBase58() === wallet ? await signMessage!(bytes) : await embedded.signMessage(bytes);
      const res = await fetch(`/api/chat/${clubId}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, signedAt, signature: bs58.encode(sig) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "not_member" ? "This chat is for people who checked in to this club. Scan one of their event QR codes first."
          : data.error === "schema_not_ready" ? "Chat isn’t set up yet on this server."
          : "Couldn’t open the chat. Try again.");
        return;
      }
      try { localStorage.setItem(key!, JSON.stringify({ token: data.token, expiresAt: data.expiresAt })); } catch {}
      setToken(data.token);
    } catch { setError("Signature cancelled."); } finally { setBusy(false); }
  }

  return <><SiteHeader view="profile" />
    <main className="shell chat-page">
      <div className="chat-page-head">
        <h1>{club?.name ?? "Club"} chat</h1>
        <p>Groups your officers set up for the club and for each job.</p>
      </div>
      {token
        ? <ChatPanel clubId={clubId} officer={false} headers={{ "x-chat-token": token }} />
        : <div className="dash-signin">
            <Icon name="chat" size={22}/>
            <div><strong>{wallet ? "Open the club chat" : "Sign in to chat"}</strong><span>{wallet ? "Sign a short message with your wallet to prove it’s you. It’s free and stays signed in for 7 days." : "Use the wallet you checked in with."}</span></div>
            <button className="button primary" disabled={busy} onClick={signIn}>{busy ? "Waiting for your wallet…" : wallet ? "Open chat" : embedded.enabled ? "Sign in" : "Connect wallet"} <Icon name="arrow" size={15}/></button>
            {error && <p className="form-error" role="alert" style={{ flexBasis: "100%" }}>{error}</p>}
          </div>}
    </main>
  </>;
}
