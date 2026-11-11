"use client";

import type { AppRecordApp } from "@brawzer/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { fetchAppRecords, putAppRecord } from "@/lib/api/app-records";

export type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * One record an app keeps with the account (sealed on the server, never on
 * this computer): loaded when the app opens, saved half a second after each
 * change, and once more when the window closes.
 */
export function useAppRecord<T>(app: AppRecordApp, key: string, schema: z.ZodType<T>, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState<"loading" | "ready" | "failed">("loading");
  const [save, setSave] = useState<SaveState>("idle");
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAppRecords(app).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoaded("failed");
        return;
      }
      const record = result.data.records.find((candidate) => candidate.key === key);
      const parsed = record ? schema.safeParse(record.data) : null;
      if (parsed?.success) setValue(parsed.data);
      setLoaded("ready");
    });
    return () => {
      cancelled = true;
    };
    // Loaded once per window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, key]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSave("saving");
    const result = await putAppRecord(app, key, next.value);
    // A failed save stays queued: the next change, or "Try again", sends it.
    if (!result.ok) pending.current ??= next;
    setSave(result.ok ? "saved" : "failed");
  }, [app, key]);

  // Whatever is still waiting is saved when the window closes.
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const value = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        pending.current = { value };
        return value;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 500);
    },
    [flush],
  );

  return { value, update, loaded, save, retry: flush };
}

/** "Saved", "Saving…": what the status bar says about the record. */
export function saveLabel(save: SaveState): string {
  switch (save) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved with your account";
    case "failed":
      return "Couldn’t save. Check your connection.";
    case "idle":
      return "Kept with your account, encrypted";
  }
}

/** A form field's text ("" when it's missing or a file). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A short random id for a new item. */
export const newId = () => crypto.randomUUID().slice(0, 12);
