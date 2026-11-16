"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { WalletError } from "@solana/wallet-adapter-base";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { PUBLIC_DEVNET_RPC } from "@/lib/solana";
import { EMBEDDED_WALLET_LOADING, EMBEDDED_WALLET_OFF, EmbeddedWalletContext, type EmbeddedWallet } from "@/lib/embeddedWallet";

// Privy (email / Google sign-in) is a large library, so it's downloaded only when sign-in is
// configured, and only in the browser.
const PrivyBridge = dynamic(() => import("@/components/PrivyBridge"), { ssr: false });

function onWalletError(error: WalletError) {
  // Expected errors (user rejected, locked wallet, etc.) — log as warning only.
  // Without this handler WalletProvider calls console.error, which triggers
  // the Next.js dev overlay for routine wallet interactions.
  console.warn("[wallet]", error.name, error.message);
}

export function Providers({ children, privyAppId }: { children: ReactNode; privyAppId?: string }) {
  const [embedded, setEmbedded] = useState<EmbeddedWallet>(privyAppId ? EMBEDDED_WALLET_LOADING : EMBEDDED_WALLET_OFF);
  // The browser never talks to Solana directly (balances go through /api/balance), so it gets
  // the public endpoint and the server's RPC key stays on the server.
  const endpoint = PUBLIC_DEVNET_RPC;
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect onError={onWalletError}>
        <WalletModalProvider>
          <EmbeddedWalletContext.Provider value={embedded}>
            {children}
          </EmbeddedWalletContext.Provider>
          {privyAppId && <PrivyBridge appId={privyAppId} onChange={setEmbedded} />}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
