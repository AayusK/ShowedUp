import { readEvents, type EventRecord } from "@/lib/server/events";
import { listOpenOpenings } from "@/lib/server/openings";
import type { OpeningInfo } from "@/lib/openings";
import HomeView from "./HomeView";

export const dynamic = "force-dynamic";

export default async function Home() {
  let events: EventRecord[] = [];
  let openings: OpeningInfo[] = [];
  // Read both at once. Either can fail on its own without taking the page down.
  const [eventsResult, openingsResult] = await Promise.allSettled([readEvents(), listOpenOpenings()]);
  if (eventsResult.status === "fulfilled") events = eventsResult.value;
  else {
    // The home page still renders (without the events section) if the database is unreachable.
    console.error("[home] could not load events:", eventsResult.reason instanceof Error ? eventsResult.reason.message : "unknown");
  }
  if (openingsResult.status === "fulfilled") openings = openingsResult.value;
  else {
    // Same for openings: no tables yet, or no database, means no openings section.
    console.error("[home] could not load openings:", openingsResult.reason instanceof Error ? openingsResult.reason.message.split("\n")[0] : "unknown");
  }
  return <HomeView
    // Contribution badges aren't events people can come to: the home page lists attendance only.
    events={events.filter((e) => e.kind !== "contribution").map(({ id, name, date, location, mint }) => ({ id, name, date, location, mint }))}
    openings={openings.slice(0, 6).map(({ id, title, clubName, role, minCount, closesAt }) => ({ id, title, clubName, role, minCount, closesAt }))}
  />;
}
