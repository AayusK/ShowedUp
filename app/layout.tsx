import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShowedUp",
  description: "Soulbound proof-of-attendance for student clubs on Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* The Privy app ID is public by design; it's read here on the server and passed down,
            so no NEXT_PUBLIC_ variable is needed. Without it, sign-in is simply switched off. */}
        <Providers privyAppId={process.env.PRIVY_APP_ID || undefined}>{children}</Providers>
      </body>
    </html>
  );
}
