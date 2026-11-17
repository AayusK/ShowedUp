import { getOpening } from "@/lib/server/openings";
import type { OpeningInfo } from "@/lib/openings";
import OpeningView from "./OpeningView";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let opening: OpeningInfo | null = null;
  try {
    opening = await getOpening(id);
  } catch (e) {
    // The page still renders ("couldn't find that opening") if the database is unreachable.
    console.error("[openings] could not load opening:", e instanceof Error ? e.message.split("\n")[0] : "unknown");
  }
  return <OpeningView opening={opening} />;
}
