import type { Metadata } from "next";
import OrganizerView from "./OrganizerView";

export const metadata: Metadata = { title: "Club" };
export default function Page() { return <OrganizerView />; }
