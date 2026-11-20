"use client";

import type { ReceiptFile } from "@/lib/receipt";

export function ReceiptDownload({ file }: { file: ReceiptFile }) {
  function download() {
    const blob = new Blob([JSON.stringify(file, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `showedup-${file.receipt.signature.slice(0, 12)}.receipt.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button type="button" className="text-link" onClick={download}>Download receipt</button>;
}
