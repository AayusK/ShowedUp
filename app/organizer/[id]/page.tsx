import { getEvent } from "@/lib/server/events";
import CheckinView from "./CheckinView";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  return <CheckinView event={event} />;
}
