import type { Metadata } from "next";
import ChatView from "./ChatView";

export const metadata: Metadata = { title: "Club chat" };

export default async function Page({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  return <ChatView clubId={clubId} />;
}
