import { readEvents, type EventRecord } from "@/lib/server/events";
import HomeView from "./HomeView";

export const dynamic = "force-dynamic";

export default async function Home() {
  let events: EventRecord[] = [];
  try {
    events = await readEvents();
  } catch (e) {
    // The home page still renders (without the events section) if the database is unreachable.
    console.error("[home] could not load events:", e instanceof Error ? e.message : "unknown");
  }
  // Contribution badges aren't events people can come to: the home page lists attendance only.
  return <HomeView events={events.filter((e) => e.kind !== "contribution").map(({ id, name, date, location, mint }) => ({ id, name, date, location, mint }))} />;
}
