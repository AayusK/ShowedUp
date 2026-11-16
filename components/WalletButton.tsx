"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export function WalletButton() {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
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

  return (
    <button className="wallet-button" onClick={() => setVisible(true)} aria-label="Connect wallet">
      <Icon name="wallet" size={16} />
      <span>Connect wallet</span>
    </button>
  );
}
