import { getEvent } from "@/lib/server/events";
import { eventClubId } from "@/lib/server/auth";
import { getClub } from "@/lib/server/clubs";
import { LEGACY_CLUB_ID } from "@/lib/clubs";
import CheckinView from "./CheckinView";
import RecipientsView from "./RecipientsView";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  // The club this event belongs to: the page asks for that club's passcode.
  const club = event ? await getClub(eventClubId(event)).catch(() => null) : null;
  // If the club can't be looked up right now, still ask for the right club's passcode.
  const clubProp = { id: event ? eventClubId(event) : LEGACY_CLUB_ID, name: club?.name ?? "this club" };
  // A contribution badge has no QR code: show who has it instead of the check-in screen.
  if (event?.kind === "contribution") return <RecipientsView event={event} club={clubProp} />;
  return <CheckinView event={event} club={clubProp} />;
}
