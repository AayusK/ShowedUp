import { getEvent } from "@/lib/server/events";
import ClaimView from "./ClaimView";

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
  return <ClaimView event={event} code={code} />;
}
