/**
 * Phantom's universal "browse" link. Opened on a phone (e.g. from a camera QR scan), it launches
 * the Phantom app and loads `url` inside Phantom's built-in browser, where the wallet is available.
 * If Phantom isn't installed, the phone shows Phantom's download page instead.
 * Docs: https://docs.phantom.com/phantom-deeplinks/other-methods/browse
 */
export function phantomBrowseLink(url: string, ref: string): string {
  return `https://phantom.com/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`;
}

export function isMobileDevice(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
