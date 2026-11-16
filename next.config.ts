import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones reach the dev server through a Cloudflare quick tunnel (see README).
  // Without this, Next's dev server may block its own dev resources (e.g. hot reload)
  // when they're requested from the tunnel's domain.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Privy (email / Google sign-in) has an optional Farcaster integration we don't use or
  // install. Tell webpack to skip it instead of warning "Module not found" on every build.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, "@farcaster/mini-app-solana": false };
    return config;
  },
};

export default nextConfig;
