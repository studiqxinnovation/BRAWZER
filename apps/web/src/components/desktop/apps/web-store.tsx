"use client";

import type { Profile } from "@brawzer/contracts";
import { useEffect, useState } from "react";
import { ExtensionsManager } from "@/components/extensions/extensions-manager";
import { fetchProfiles } from "@/lib/api/profiles";

/** Web Store: Brawzer's reviewed extensions, added to a profile's browser. */
export default function WebStoreApp() {
  const [profiles, setProfiles] = useState<readonly Profile[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetchProfiles().then((result) => {
      if (result.ok) setProfiles(result.data.profiles);
      else setFailed(true);
    });
  }, []);
  return (
    <div className="ap-body">
      <div className="ap-main">
        <p className="ap-note">
          Open-source extensions Brawzer has reviewed, each pinned to a release and installed into a
          profile’s browser when its session starts. They run in the cloud, never on this computer.
        </p>
        {failed ? (
          <p className="ap-empty">
            The extensions couldn’t be read. Close this window and open it again.
          </p>
        ) : profiles ? (
          <ExtensionsManager profiles={profiles} />
        ) : null}
      </div>
    </div>
  );
}
