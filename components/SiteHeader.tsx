"use client";

import Link from "next/link";
import { WalletButton } from "./WalletButton";

export type NavView = "home" | "organizer" | "event" | "claim" | "profile" | "verify";

export function SiteHeader({ view }: { view: NavView }) {
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand"><span className="brand-mark">↗</span>ShowedUp<span className="beta">DEVNET</span></Link>
        <nav aria-label="Main navigation">
          <Link className={view === "home" ? "active" : ""} href="/">Overview</Link>
          <Link className={["organizer", "event"].includes(view) ? "active" : ""} href="/organizer">Organizer</Link>
          <Link className={view === "profile" || view === "verify" ? "active" : ""} href="/profile/me">My attendance</Link>
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
