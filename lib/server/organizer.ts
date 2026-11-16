import "server-only";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function getOrganizerKeypair(): Keypair {
  const raw = process.env.ORGANIZER_SECRET_KEY;
  if (!raw) throw new Error("ORGANIZER_SECRET_KEY is not set");
  try {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(raw));
  }
}
