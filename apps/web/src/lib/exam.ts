"use client";

import { examRecordSchema } from "@brawzer/contracts";
import type { z } from "zod";
import { deleteAppRecord, fetchAppRecords, putAppRecord } from "./api/app-records";

/**
 * Exam Mode (a desktop app): for a set time, only the apps and browsers the
 * person chose open on the desktop, and the classic layout is off. It's kept
 * with the account, so a reload or another tab keeps to it; ending it early
 * asks for the password.
 */
export const examSchema = examRecordSchema;
export type Exam = z.infer<typeof examSchema>;

let exam: Exam | null = null;
const listeners = new Set<() => void>();

function set(next: Exam | null) {
  exam = next && next.endsAt > Date.now() ? next : null;
  for (const listener of listeners) listener();
}

export const currentExam = () => (exam && exam.endsAt > Date.now() ? exam : null);

export function subscribeToExam(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this may open now: "app:notepad", "browser:chrome". */
export function examAllows(target: string): boolean {
  const active = currentExam();
  return !active || target === "app:exam-mode" || active.allowed.includes(target);
}

/** Reads the account's exam, if one is running. */
export async function loadExam(): Promise<void> {
  const result = await fetchAppRecords("exam-mode");
  if (!result.ok) return;
  const record = result.data.records.find((candidate) => candidate.key === "current");
  const parsed = record ? examSchema.safeParse(record.data) : null;
  set(parsed?.success ? parsed.data : null);
}

export async function startExam(next: Exam): Promise<boolean> {
  const result = await putAppRecord("exam-mode", "current", next);
  if (result.ok) set(next);
  return result.ok;
}

/** At the end of its time, or early once the password is given. */
export async function endExam(): Promise<boolean> {
  const result = await deleteAppRecord("exam-mode", "current");
  if (result.ok || result.status === 404) set(null);
  return result.ok || result.status === 404;
}
