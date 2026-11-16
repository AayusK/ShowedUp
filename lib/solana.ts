import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

// Public devnet endpoint. Safe for the browser; the server uses RPC_URL (see lib/server/mint.ts).
export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";
export { TOKEN_2022_PROGRAM_ID };

export function explorerLink(address: string, type: "address" | "tx" = "address"): string {
  return `https://explorer.solana.com/${type}/${address}?cluster=devnet`;
}
