import type { Metadata } from "next";
import { Landing } from "@/components/site/landing/landing";

export const metadata: Metadata = {
  title: { absolute: "Brawzer — Browse anywhere. Leave nothing behind." },
  description:
    "Brawzer runs your browser in the cloud. On a computer you don’t own, the screen is only a window: your profiles, history and downloads stay with you.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <Landing />;
}
