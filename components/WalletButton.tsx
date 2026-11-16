"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useEmbeddedWallet } from "@/lib/embeddedWallet";

export function WalletButton() {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  // Signed in with email / Google (a wallet created behind the scenes). A connected Phantom wins.
  const embedded = useEmbeddedWallet();
  const usingEmbedded = !(connected && publicKey) && !!embedded.address;
  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    let cancelled = false;
    // Ask our own server, which holds the RPC key, instead of calling Solana from the browser.
    fetch(`/api/balance/${publicKey.toBase58()}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { sol: number }) => { if (!cancelled) setBalance(d.sol); })
      .catch(() => { if (!cancelled) setBalance(null); });
    return () => { cancelled = true; };
  }, [publicKey]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (usingEmbedded && embedded.address) {
    // People who signed in never need SOL, so there's no balance here: just "you're signed in".
    const addr = embedded.address;
    const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
    return (
      <div ref={containerRef} className="wallet-button-wrap">
        <button
          className="wallet-button"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={`Signed in, ${short}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Icon name="wallet" size={16} />
          <span>Signed in · {short}</span>
        </button>
        {menuOpen && (
          <div className="wallet-menu" role="menu">
            <button role="menuitem" onClick={() => { void embedded.logout(); setMenuOpen(false); }}>
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
    const sol = balance !== null ? `${balance.toFixed(2)} SOL` : "…";
    return (
      <div ref={containerRef} className="wallet-button-wrap">
        <button
          className="wallet-button"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={`Wallet ${short}, ${sol}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Icon name="wallet" size={16} />
          <span>{short} · {sol}</span>
        </button>
        {menuOpen && (
          <div className="wallet-menu" role="menu">
            <button role="menuitem" onClick={() => { disconnect(); setMenuOpen(false); }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  if (embedded.enabled) {
    // Sign-in is the main way in; Phantom is offered on the claim and My attendance pages.
    return (
      <button className="wallet-button" onClick={() => embedded.login()} disabled={!embedded.ready} aria-label="Sign in">
        <Icon name="wallet" size={16} />
        <span>Sign in</span>
      </button>
    );
  }

  return (
    <button className="wallet-button" onClick={() => setVisible(true)} aria-label="Connect wallet">
      <Icon name="wallet" size={16} />
      <span>Connect wallet</span>
    </button>
  );
}
