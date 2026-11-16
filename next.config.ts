import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phones reach the dev server through a Cloudflare quick tunnel (see README).
  // Without this, Next's dev server may block its own dev resources (e.g. hot reload)
  // when they're requested from the tunnel's domain.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
