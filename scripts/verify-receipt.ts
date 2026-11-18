// Checks a ShowedUp record file against Solana devnet. It needs no ShowedUp server, no database
// and no secrets (it doesn't even read .env.local): only the file, a public Solana RPC, and the
// club address you already trust.
//
// Usage:  npm run receipt:verify -- <file> [--issuer <club address you trust>] [--rpc <url>]
import { readFileSync } from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { PUBLIC_DEVNET_RPC, explorerLink } from "../lib/solana";
import { ReceiptFormatError, parseReceiptFile, verifyReceipt, type VerifyFailure } from "../lib/receipt";

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function failureText(reason: VerifyFailure, issuer: string, trusted: boolean): string {
  switch (reason) {
    case "edited":
      return "EDITED. The club signed a different version of this record: something in it (or its salt) was changed afterwards.";
    case "not_signed_by_issuer":
      return trusted
        ? `NOT ISSUED BY ${issuer}. That address did not sign this receipt.`
        : `NOT VALID. The address the file names (${issuer}) did not sign this receipt.`;
    case "no_memo":
      return "NOT VALID. That transaction holds no ShowedUp receipt.";
    case "failed_tx":
      return "NOT VALID. That transaction failed on Solana, so nothing was recorded.";
    case "not_found":
      return "NOT FOUND. There is no such transaction on Solana devnet.";
    case "rpc_error":
      return "Couldn't reach Solana. Try again, or pass --rpc <url>.";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((a, i) => !a.startsWith("--") && !["--issuer", "--rpc"].includes(args[i - 1]));
  const trustedIssuer = option(args, "--issuer");
  const rpc = option(args, "--rpc") ?? PUBLIC_DEVNET_RPC;
  if (!path) {
    console.error("Usage: npm run receipt:verify -- <file> [--issuer <club address you trust>] [--rpc <url>]");
    process.exit(2);
  }
  if (trustedIssuer !== undefined) {
    try {
      new PublicKey(trustedIssuer);
    } catch {
      console.error(`--issuer must be a Solana address, got "${trustedIssuer}".`);
      process.exit(2);
    }
  }

  let file;
  try {
    file = parseReceiptFile(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    const why = e instanceof ReceiptFormatError ? e.message : e instanceof SyntaxError ? "not valid JSON" : "couldn't read the file";
    console.error(`Can't check ${path}: ${why}.`);
    process.exit(2);
  }

  let connection: Connection;
  try {
    connection = new Connection(rpc, "confirmed");
  } catch {
    // Don't echo the URL: RPC URLs often carry an API key.
    console.error("--rpc must be an http:// or https:// URL.");
    process.exit(2);
  }

  const issuer = trustedIssuer ?? file.receipt.issuer;
  const result = await verifyReceipt(file, connection, trustedIssuer);
  if (!result.ok) {
    console.log(failureText(result.reason, issuer, Boolean(trustedIssuer)));
    process.exit(result.reason === "rpc_error" ? 2 : 1);
  }

  const when = result.blockTime ? `${new Date(result.blockTime * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "time unknown";
  console.log("VALID. This record is exactly what the club confirmed.");
  console.log(`  signed by    ${result.issuer}`);
  if (!trustedIssuer) {
    console.log("               (the address the file names: check it's the club's published address, or pass --issuer)");
  } else if (trustedIssuer !== file.receipt.issuer) {
    console.log(`               (the address you trust; the file itself names ${file.receipt.issuer})`);
  } else {
    console.log("               (matches the address you trust)");
  }
  console.log(`  on Solana    ${when}, slot ${result.slot}`);
  console.log(`  transaction  ${explorerLink(result.signature, "tx")}`);
  console.log("");
  console.log(JSON.stringify(file.record, null, 2));
}

main();
