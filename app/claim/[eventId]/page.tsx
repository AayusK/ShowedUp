import type { Metadata } from "next";
import { getEvent } from "@/lib/server/events";
import { eventClubId } from "@/lib/server/auth";
import { getClub } from "@/lib/server/clubs";
import ClaimView from "./ClaimView";

export const metadata: Metadata = { title: "Check in" };

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const { eventId } = await params;
  const { c } = await searchParams;
  const event = await getEvent(eventId);
  const code = typeof c === "string" ? c.trim().toUpperCase() : "";
  const club = event ? await getClub(eventClubId(event)).catch(() => null) : null;
  return <ClaimView event={event} code={code} clubName={club?.name ?? "ShowedUp"} />;
}
