"use client";

import { useSearchParams } from "next/navigation";
import { SupportCentre } from "./support-centre";

/** The Help page's body: opens the request an email linked to, if any. */
export function HelpPageBody() {
  const params = useSearchParams();
  return <SupportCentre initialTicket={params.get("ticket")} />;
}
