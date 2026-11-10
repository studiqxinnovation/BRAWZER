"use client";

import { type Profile } from "@brawzer/contracts";
import { Switch } from "@brawzer/ui/components/switch";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateProfile } from "@/lib/api/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";

/** The catalogue's ad and tracker blocker for an engine: uBlock Origin on Firefox, Lite elsewhere. */
const blockerFor = (profile: Profile) =>
  profile.engine === "firefox" ? "ublock-origin" : "ubo-lite";
const BLOCKERS = new Set(["ublock-origin", "ubo-lite"]);

/**
 * Ad and tracker blocking for a profile: installs or removes the catalogue's
 * uBlock Origin (ADR 0018), from the profile's next session.
 */
export function AdBlockerSwitch({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(profile.extensions.some((slug) => BLOCKERS.has(slug)));
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    setSaving(true);
    setOn(next);
    const extensions = next
      ? [...profile.extensions.filter((slug) => !BLOCKERS.has(slug)), blockerFor(profile)]
      : profile.extensions.filter((slug) => !BLOCKERS.has(slug));
    const result = await updateProfile(profile.id, { extensions });
    setSaving(false);
    if (!result.ok) {
      setOn(!next);
      if (result.status === 401) leaveSignedInArea("expired");
      else
        toast.add({
          type: "error",
          title: "The blocker wasn’t changed",
          description: result.error.message,
        });
      return;
    }
    toast.add({
      type: "success",
      title: next
        ? `uBlock Origin installs into “${profile.name}” from its next session`
        : `uBlock Origin leaves “${profile.name}” from its next session`,
    });
    router.refresh();
  }

  return (
    <Switch
      aria-label={`Ad and tracker blocker in “${profile.name}”`}
      checked={on}
      disabled={saving}
      onCheckedChange={(next) => void change(next)}
    />
  );
}
