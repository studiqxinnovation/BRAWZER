"use client";

import { SupportCentre } from "@/components/support/support-centre";
import { useAppWindow } from "./app-window";

/** Help: ask Brawzer's team, follow the replies. Opened from an email's link with ?ticket=. */
export default function HelpApp() {
  const window = useAppWindow();
  return (
    <div className="ap-body" style={{ overflow: "auto" }}>
      <SupportCentre compact initialTicket={window.params.ticket ?? null} />
    </div>
  );
}
