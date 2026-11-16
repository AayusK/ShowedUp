"use client";

import { useEffect, useMemo, useRef } from "react";
import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";
import type { EmbeddedWallet } from "@/lib/embeddedWallet";

/**
 * The only file that imports Privy. It's loaded in the browser only when PRIVY_APP_ID is set
 * (see app/providers.tsx) and reports the sign-in state up through `onChange`.
 *
 * What Privy does here: the visitor signs in with email or Google, and Privy creates a Solana
 * wallet for them (an ordinary Solana keypair that Privy keeps for that user; our server never
 * sees its secret). That wallet signs the same claim message a Phantom wallet would, so the server's signature
 * check doesn't change.
 */
export default function PrivyBridge({ appId, onChange }: { appId: string; onChange: (state: EmbeddedWallet) => void }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        appearance: { walletChainType: "solana-only" },
        embeddedWallets: {
          // Create a Solana wallet the first time someone signs in. No Ethereum wallet.
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
          // Sign the claim message without an extra "approve" pop-up.
          showWalletUIs: false,
        },
      }}
    >
      <Bridge onChange={onChange} />
    </PrivyProvider>
  );
}

function Bridge({ onChange }: { onChange: (state: EmbeddedWallet) => void }) {
  const { ready, authenticated, logout } = usePrivy();
  const { login } = useLogin();
  const { ready: walletsReady, wallets } = useWallets();
  const { signMessage } = useSignMessage();

  // The wallet Privy created for this visitor (not a browser-extension wallet).
  const wallet = authenticated ? (wallets.find((w) => w.standardWallet.name === "Privy") ?? null) : null;
  const address = wallet?.address ?? null;

  // Privy's functions can change identity between renders. Keep the latest ones in a ref and
  // hand out wrappers that never change, so reporting state upward can't loop.
  const latest = useRef({ login, logout, signMessage, wallet });
  useEffect(() => {
    latest.current = { login, logout, signMessage, wallet };
  });
  const actions = useMemo(
    () => ({
      login: () => latest.current.login({ loginMethods: ["email", "google"] }),
      logout: () => latest.current.logout(),
      signMessage: async (message: Uint8Array) => {
        const { wallet: current, signMessage: sign } = latest.current;
        if (!current) throw new Error("No wallet yet");
        const { signature } = await sign({
          message,
          wallet: current,
          options: { uiOptions: { showWalletUIs: false } },
        });
        return signature;
      },
    }),
    [],
  );

  useEffect(() => {
    onChange({
      enabled: true,
      ready: ready && (!authenticated || walletsReady),
      authenticated,
      address,
      ...actions,
    });
  }, [ready, walletsReady, authenticated, address, actions, onChange]);

  return null;
}
