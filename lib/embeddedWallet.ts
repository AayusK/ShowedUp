"use client";

import { createContext, useContext } from "react";

/**
 * The "no crypto app needed" wallet. When an attendee signs in with email or Google, Privy
 * creates a Solana wallet for them behind the scenes. Pages read it through this context, so
 * nothing outside components/PrivyBridge.tsx imports Privy.
 */
export interface EmbeddedWallet {
  /** False when PRIVY_APP_ID isn't set. The app then works with Phantom only, as before. */
  enabled: boolean;
  /** True once we know whether the visitor is signed in (and, if so, their wallet has loaded). */
  ready: boolean;
  authenticated: boolean;
  /** The signed-in visitor's wallet address, or null. */
  address: string | null;
  /** Opens the email / Google sign-in window. */
  login: () => void;
  logout: () => Promise<void>;
  /** Signs bytes with the visitor's wallet. Free, sends nothing on-chain. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

const notAvailable = () => Promise.reject(new Error("Sign-in isn't available"));

export const EMBEDDED_WALLET_OFF: EmbeddedWallet = {
  enabled: false,
  ready: true,
  authenticated: false,
  address: null,
  login: () => {},
  logout: () => Promise.resolve(),
  signMessage: notAvailable,
};

/** Sign-in is configured, but Privy's code is still loading in the browser. */
export const EMBEDDED_WALLET_LOADING: EmbeddedWallet = { ...EMBEDDED_WALLET_OFF, enabled: true, ready: false };

export const EmbeddedWalletContext = createContext<EmbeddedWallet>(EMBEDDED_WALLET_OFF);

export function useEmbeddedWallet(): EmbeddedWallet {
  return useContext(EmbeddedWalletContext);
}
