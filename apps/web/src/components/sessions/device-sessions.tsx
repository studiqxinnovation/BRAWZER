import { type DeviceSession, deviceSessionListSchema } from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { Laptop, Monitor, MonitorSmartphone, Smartphone } from "lucide-react";
import { Panel, Unavailable } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { serverGet, signInAgain } from "@/lib/server-api";
import { timeAgo } from "@/lib/time";
import { EndOtherSessionsButton, EndSessionButton } from "./session-actions";

function DeviceIcon({ device }: { device: string | null }) {
  const Icon = !device
    ? MonitorSmartphone
    : /iOS|Android/.test(device)
      ? Smartphone
      : /macOS|ChromeOS/.test(device)
        ? Laptop
        : Monitor;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-secondary">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}

function DeviceRow({ session, now }: { session: DeviceSession; now: number }) {
  const device = session.device ?? "Unknown device";
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <DeviceIcon device={session.device} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout font-medium text-ink">
            {device}
            {session.current && <Badge tone="accent">This device</Badge>}
          </p>
          <p className="mt-0.5 text-footnote text-ink-secondary">
            {session.persistent ? "Kept signed in" : "Shared-computer mode"}
            {" · "}
            {session.current ? "Active now" : `Active ${timeAgo(session.lastActiveAt, now)}`}
          </p>
          <p className="text-footnote text-ink-secondary">
            Signed in <LocalDate iso={session.createdAt} />
            {session.ipAddress && <> · IP {session.ipAddress}</>}
          </p>
        </div>
      </div>
      {!session.current && (
        <div className="pl-14 sm:pl-0">
          <EndSessionButton id={session.id} device={device} />
        </div>
      )}
    </li>
  );
}

export function DeviceSessionsSkeleton() {
  return <Skeleton className="h-48 w-full rounded-xl" />;
}

/** The account's signed-in devices, read from the API for this request. */
export async function DeviceSessions() {
  const result = await serverGet("/auth/sessions", deviceSessionListSchema);
  if (result.kind === "signed-out") signInAgain("/app/sessions");
  if (result.kind === "unavailable") return <Unavailable />;

  const now = result.receivedAt;
  const { sessions } = result.data;
  const others = sessions.filter((session) => !session.current).length;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <ul className="divide-y divide-line">
          {sessions.map((session) => (
            <DeviceRow key={session.id} session={session} now={now} />
          ))}
        </ul>
      </Panel>
      {others > 0 ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-footnote text-ink-secondary">
            A Brawzer page left open on a signed-out device clears itself within about 30 seconds.
          </p>
          <EndOtherSessionsButton count={others} />
        </div>
      ) : (
        <p className="text-callout text-ink-secondary">No other devices are signed in.</p>
      )}
    </div>
  );
}
