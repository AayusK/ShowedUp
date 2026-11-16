"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { WalletError } from "@solana/wallet-adapter-base";
import type { ReactNode } from "react";
import { PUBLIC_DEVNET_RPC } from "@/lib/solana";

function onWalletError(error: WalletError) {
  // Expected errors (user rejected, locked wallet, etc.) — log as warning only.
  // Without this handler WalletProvider calls console.error, which triggers
  // the Next.js dev overlay for routine wallet interactions.
  console.warn("[wallet]", error.name, error.message);
}

export function Providers({ children }: { children: ReactNode }) {
  // The browser never talks to Solana directly (balances go through /api/balance), so it gets
  // the public endpoint and the server's RPC key stays on the server.
  const endpoint = PUBLIC_DEVNET_RPC;
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect onError={onWalletError}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
