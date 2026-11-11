"use client";

import { type BrowserEngine, engineDetails } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { Field, FieldLabel } from "@brawzer/ui/components/field";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CodeField, useIdentityCheck } from "@/components/app-shell/confirm-identity";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { subscribeToClock } from "@/lib/clock";
import { currentExam, endExam, startExam, subscribeToExam } from "@/lib/exam";
import { type AppId, appIds, apps, isAppId } from "./registry";

const LENGTHS = [30, 45, 60, 90, 120, 180];
const STUDY_APPS: readonly AppId[] = ["calculator", "assignments", "citations", "focus-timer"];
const minuteNow = () => Math.floor(Date.now() / 15_000);

/** For a set time, only the apps and browsers chosen open on this desktop. */
export default function ExamModeApp() {
  const exam = useSyncExternalStore(subscribeToExam, currentExam, () => null);
  const tick = useSyncExternalStore(subscribeToClock, minuteNow, () => 0);
  const [minutes, setMinutes] = useState(60);
  const [engines, setEngines] = useState<readonly BrowserEngine[]>([]);
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(
    () => new Set(STUDY_APPS.filter((app) => appIds.includes(app)).map((app) => `app:${app}`)),
  );
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const check = useIdentityCheck(() => {
    void endExam();
    setEnding(false);
  });

  useEffect(() => {
    void fetchBrowserOverview().then((result) => {
      if (result.ok) setEngines(result.data.engines);
    });
  }, []);

  if (exam) {
    const left = Math.max(0, Math.ceil((exam.endsAt - tick * 15_000) / 60_000));
    return (
      <div className="ap-body">
        <div className="ap-main ap-exam">
          <ShieldCheck aria-hidden="true" className="ap-exam-icon" />
          <h2 className="ap-section-title">Exam Mode is on</h2>
          <p className="ap-exam-left" role="timer">
            {left} min left
          </p>
          <p className="text-footnote text-ink-secondary">
            Until{" "}
            {new Date(exam.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })},
            only these open on this desktop:
          </p>
          <ul className="ap-chips">
            {exam.allowed.length === 0 && <li>Nothing but Brawzer’s own pages</li>}
            {exam.allowed.map((target) => {
              const [kind, id = ""] = target.split(":");
              const label =
                kind === "browser"
                  ? id in engineDetails
                    ? engineDetails[id as BrowserEngine].short
                    : id
                  : isAppId(id)
                    ? apps[id].name
                    : id;
              return <li key={target}>{label}</li>;
            })}
          </ul>
          {ending ? (
            <form
              method="post"
              className="ap-exam-end"
              onSubmit={(event) => void check.submit(event)}
              noValidate
            >
              {check.failure && <FormMessage tone="danger">{check.failure}</FormMessage>}
              <Field name="password" invalid={check.error !== null}>
                <FieldLabel>Your password, to end it early</FieldLabel>
                <PasswordInput name="password" autoComplete="current-password" required />
              </Field>
              {check.error && (
                <p className="ap-error" role="alert">
                  {check.error}
                </p>
              )}
              {check.needsCode && <CodeField error={check.codeError} />}
              <div className="flex gap-2">
                <Button type="submit" variant="danger" loading={check.pending}>
                  End Exam Mode
                </Button>
                <Button
                  onClick={() => {
                    setEnding(false);
                    check.reset();
                  }}
                >
                  Keep going
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setEnding(true);
              }}
            >
              End early…
            </Button>
          )}
        </div>
      </div>
    );
  }

  const toggle = (target: string) => {
    setAllowed((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  };

  return (
    <div className="ap-body">
      <div className="ap-main ap-exam-setup">
        <p className="text-callout text-ink-secondary">
          For the time you choose, only the apps and browsers you tick open on this desktop, and the
          classic layout stays off. Ending early asks for your password. It’s kept with your
          account, so reloading doesn’t end it.
        </p>
        <label className="ap-field ap-inline">
          <span>How long</span>
          <select
            className="ap-input"
            value={minutes}
            onChange={(event) => {
              setMinutes(Number(event.target.value));
            }}
          >
            {LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length < 60
                  ? `${String(length)} minutes`
                  : `${String(length / 60)} hour${length === 60 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="ap-fieldset">
          <legend>Allowed apps</legend>
          {appIds
            .filter((app) => app !== "exam-mode" && app !== "settings")
            .map((app) => (
              <label key={app} className="ap-check-row">
                <input
                  type="checkbox"
                  checked={allowed.has(`app:${app}`)}
                  onChange={() => {
                    toggle(`app:${app}`);
                  }}
                />
                {apps[app].name}
              </label>
            ))}
        </fieldset>
        {engines.length > 0 && (
          <fieldset className="ap-fieldset">
            <legend>Allowed browsers</legend>
            {engines.map((engine) => (
              <label key={engine} className="ap-check-row">
                <input
                  type="checkbox"
                  checked={allowed.has(`browser:${engine}`)}
                  onChange={() => {
                    toggle(`browser:${engine}`);
                  }}
                />
                {engineDetails[engine].short}
              </label>
            ))}
          </fieldset>
        )}
        {failure && <FormMessage tone="danger">{failure}</FormMessage>}
        <div>
          <Button
            variant="primary"
            size="lg"
            loading={starting}
            onClick={() => {
              setStarting(true);
              setFailure(null);
              void startExam({ endsAt: Date.now() + minutes * 60_000, allowed: [...allowed] }).then(
                (ok) => {
                  setStarting(false);
                  if (!ok)
                    setFailure("Exam Mode couldn’t start. Check your connection and try again.");
                },
              );
            }}
          >
            <ShieldCheck aria-hidden="true" />
            Start Exam Mode
          </Button>
        </div>
      </div>
    </div>
  );
}
