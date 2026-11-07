import { getSession } from "@/lib/session";
import { SessionKeeper } from "./session-keeper";

/** Starts the session keeper with the real session's settings. */
export async function SessionKeeperLoader() {
  const state = await getSession();
  if (state.kind !== "ok") return null;
  const { persistent, idleTimeoutMinutes } = state.data.session;
  return <SessionKeeper persistent={persistent} idleTimeoutMinutes={idleTimeoutMinutes} />;
}
