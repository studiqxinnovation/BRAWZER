import { browserOverviewSchema, engineDetails, profileListSchema } from "@brawzer/contracts";
import { Empty, InfoHead, Panel, Pill, Unavailable } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { serverGet, signInAgain } from "@/lib/server-api";

/** Why a session ended, in a few words. */
function whyEnded(reason: string | null): string {
  switch (reason) {
    case "user":
      return "Ended by you";
    case "idle":
      return "15 minutes unwatched";
    case "max_lifetime":
      return "4-hour limit";
    case "signed_out":
      return "Signed out";
    case "handed_off":
      return "Continued on another device";
    case "runtime_failed":
      return "Stopped unexpectedly";
    case "admin":
      return "Ended by an administrator";
    case "team_left":
      return "Left the team";
    default:
      return "Ended";
  }
}

function duration(startedAt: string, endedAt: string): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * The prototype's History table: the cloud browsers that ended, each wiped
 * with its container. What was browsed is never here; a profile's history
 * is its own, on the Profiles page.
 */
export async function SessionHistory() {
  const [overview, profiles] = await Promise.all([
    serverGet("/browser", browserOverviewSchema),
    serverGet("/profiles", profileListSchema),
  ]);
  if (overview.kind === "signed-out") signInAgain("/app/sessions");
  if (overview.kind === "unavailable") return <Unavailable />;
  const names = new Map(
    profiles.kind === "ok"
      ? profiles.data.profiles.map((profile) => [profile.id, profile.name])
      : [],
  );
  const ended = overview.data.activity.ended;
  return (
    <Panel>
      <InfoHead title="History">
        <span className="ad-info-count">
          {ended.length === 1 ? "1 ended session" : `${String(ended.length)} ended sessions`}
          {ended.length === 20 ? " shown" : ""}
        </span>
      </InfoHead>
      {ended.length === 0 ? (
        <Empty>No sessions yet. Each one is listed here once it ends.</Empty>
      ) : (
        <table className="ad-table" aria-label="Session history">
          <thead>
            <tr>
              <th scope="col">Browser</th>
              <th scope="col">Profile</th>
              <th scope="col">Started</th>
              <th scope="col">Duration</th>
              <th scope="col">Ended</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {ended.map((session) => (
              <tr key={session.id}>
                <td className="strong">{engineDetails[session.engine].short}</td>
                <td>
                  {session.profileId
                    ? (names.get(session.profileId) ?? "Deleted profile")
                    : "Temporary"}
                </td>
                <td>
                  <LocalDate iso={session.startedAt} time />
                </td>
                <td>{duration(session.startedAt, session.endedAt)}</td>
                <td>{whyEnded(session.reason)}</td>
                <td>
                  <Pill tone="green">Wiped</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
