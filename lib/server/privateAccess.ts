import "server-only";
import { PublicKey } from "@solana/web3.js";
import { privateReadMessage } from "@/lib/privateAccess";
import { verifyWalletSignature } from "./claim";

export async function authorizePrivateRead(request: Request, scope: string, targetWallet?: string): Promise<PublicKey | null> {
  try {
    const { wallet, issuedAt, signature } = await request.json();
    if (typeof wallet !== "string" || wallet.length > 44 || (targetWallet && wallet !== targetWallet)
      || typeof signature !== "string" || signature.length > 90 || !Number.isSafeInteger(issuedAt)) return null;
    const age = Date.now() - issuedAt;
    if (age < -30_000 || age > 5 * 60_000) return null;
    const owner = new PublicKey(wallet);
    if (!PublicKey.isOnCurve(owner.toBytes()) || owner.toBase58() !== wallet) return null;
    // Next can use its internal localhost address for request.url; the wallet signed the
    // public host it visited. Vercel supplies the original protocol after TLS termination.
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.slice(0, -1);
    if (proto !== "http" && proto !== "https") return null;
    const origin = new URL(`${proto}://${host}`).origin;
    if (request.headers.has("origin") && request.headers.get("origin") !== origin) return null;
    const message = privateReadMessage(origin, scope, wallet, issuedAt);
    return verifyWalletSignature(wallet, message, signature) ? owner : null;
  } catch {
    return null;
  }
}
