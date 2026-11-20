"use client";

import Link from "next/link";
import { WalletButton } from "./WalletButton";

export type NavView = "home" | "organizer" | "event" | "claim" | "profile" | "verify";

/**
 * The frosted top bar. Two tabs: "Club" (the officer dashboard) and "Track record" (the
 * student's own record). The logo goes home. One row at every width.
 */
export function SiteHeader({ view }: { view: NavView }) {
  const club = view === "organizer" || view === "event";
  const record = view === "profile" || view === "verify";
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="topbar-brand" aria-label="ShowedUp home"><span className="topbar-mark">↗</span><span className="topbar-name">ShowedUp</span></Link>
        <nav className="topbar-tabs" aria-label="Main navigation">
          <Link className={club ? "on" : ""} aria-current={club ? "page" : undefined} href="/organizer">Club</Link>
          <Link className={record ? "on" : ""} aria-current={record ? "page" : undefined} href="/profile/me">Track record</Link>
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
