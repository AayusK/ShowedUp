import type { Metadata } from "next";
import ProfileView from "./ProfileView";

export const metadata: Metadata = { title: "Track record" };

export default async function Page({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  return <ProfileView walletParam={decodeURIComponent(wallet)} />;
}
