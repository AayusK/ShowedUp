"use client";

import { useEffect, useRef, useState } from "react";

/** Shows a value (e.g. a wallet address) with a small "Copy" button next to it. */
export function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(value); } catch { return; }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }
  return <span className="copy-text"><code>{value}</code><button type="button" onClick={copy} aria-label="Copy address">{copied ? "Copied" : "Copy"}</button></span>;
}
