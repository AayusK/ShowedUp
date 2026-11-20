import bs58 from "bs58";

/** Read-only wallet authorization, scoped to one site and one private view. */
export function privateReadMessage(origin: string, scope: string, wallet: string, issuedAt: number) {
  return `ShowedUp private read\nSite: ${origin}\nView: ${scope}\nWallet: ${wallet}\nIssued: ${issuedAt}`;
}

export async function signedRead(
  path: string, scope: string, wallet: string, sign: (message: Uint8Array) => Promise<Uint8Array>,
) {
  const issuedAt = Date.now();
  const text = privateReadMessage(window.location.origin, scope, wallet, issuedAt);
  const signature = bs58.encode(await sign(new TextEncoder().encode(text)));
  return fetch(path, {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, issuedAt, signature }),
  });
}
