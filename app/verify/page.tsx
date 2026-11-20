import type { Metadata } from "next";
import VerifyView from "./VerifyView";

export const metadata: Metadata = { title: "Verify a wallet" };
export default function Page() { return <VerifyView />; }
