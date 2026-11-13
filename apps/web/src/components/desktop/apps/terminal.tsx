"use client";

import {
  type BrowserEngine,
  browserEngines,
  type DriveFolder,
  engineDetails,
} from "@brawzer/contracts";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { reportActivity as fetchCurrentSession } from "@/lib/api/account";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import {
  createFolder,
  deleteFile,
  fetchDriveOverview,
  listDriveFiles,
  readDriveText,
} from "@/lib/api/drive";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { lockNow } from "@/lib/lock";
import { useAppWindow } from "./app-window";
import { appFor } from "./open-with";
import { appIds, apps, isAppId } from "./registry";

interface Line {
  kind: "command" | "out" | "error";
  text: string;
}

const HELP = [
  "Brawzer’s own commands. They act on your account, like the apps do; nothing here runs on Brawzer’s servers.",
  "",
  "  ls [folder]        what's in this folder (or another)",
  "  cd <folder>        go into a folder; cd .. goes up, cd / to the top",
  "  pwd                where you are",
  "  cat <file>         show a text file",
  "  open <file|app>    open a file in its app, or an app by name",
  "  mkdir <name>       make a folder here",
  "  rm <file>          move a file to Trash",
  "  apps               the desktop's apps",
  "  browsers           the cloud browsers open now",
  "  start <browser>    open a browser: bee, chrome, firefox, edge, chromium",
  "  end <browser|all>  end a browser's session",
  "  storage            Drive's space used",
  "  whoami · date · lock · clear · help",
];

/** Splits a command line into words; quotes keep spaces in names. */
export function words(line: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/** Terminal: Brawzer's commands for Drive, the apps and the cloud browsers. */
export default function TerminalApp() {
  const window = useAppWindow();
  const { launch } = useLaunchBrowser();
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "Brawzer Terminal. Type help to see what it can do." },
  ]);
  const [input, setInput] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<readonly DriveFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState("you");
  const history = useRef<string[]>([]);
  const back = useRef(0);
  const screen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([fetchDriveOverview(), fetchCurrentSession()]).then(([overview, session]) => {
      if (overview.ok) setFolders(overview.data.folders);
      if (session.ok) setUser(session.data.account.email.split("@")[0] ?? "you");
    });
  }, []);
  useEffect(() => {
    screen.current?.scrollTo({ top: screen.current.scrollHeight });
  }, [lines]);

  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    let current = id;
    for (let depth = 0; current && depth < 16; depth += 1) {
      const found = folders.find((entry) => entry.id === current);
      if (!found) break;
      parts.unshift(found.name);
      current = found.parentId;
    }
    return `/${parts.join("/")}`;
  };
  const child = (parent: string | null, name: string) =>
    folders.find(
      (entry) => entry.parentId === parent && entry.name.toLowerCase() === name.toLowerCase(),
    );
  /** A folder path from here: "Notes", "../Docs", "/Invoices/2026". */
  const resolve = (path: string): string | null | undefined => {
    let current: string | null = path.startsWith("/") ? null : folder;
    for (const part of path.split("/").filter(Boolean)) {
      if (part === ".") continue;
      if (part === "..") {
        current = folders.find((entry) => entry.id === current)?.parentId ?? null;
        continue;
      }
      const next = child(current, part);
      if (!next) return undefined;
      current = next.id;
    }
    return current;
  };
  const fileHere = async (name: string) => {
    const listed = await listDriveFiles({ folderId: folder });
    return listed.ok
      ? listed.data.files.find((file) => file.name.toLowerCase() === name.toLowerCase())
      : undefined;
  };

  async function run(command: string, args: string[]): Promise<Line[]> {
    const out = (...text: string[]): Line[] => text.map((value) => ({ kind: "out", text: value }));
    const fail = (text: string): Line[] => [{ kind: "error", text }];
    switch (command) {
      case "help":
        return out(...HELP);
      case "clear":
        setLines([]);
        return [];
      case "date":
        return out(new Date().toString());
      case "whoami":
        return out(user);
      case "pwd":
        return out(pathOf(folder));
      case "apps":
        return out(...appIds.map((app) => `${app.padEnd(14)}${apps[app].name}`));
      case "lock":
        await lockNow();
        return out("Locked.");
      case "ls": {
        const target = args[0] ? resolve(args[0]) : folder;
        if (target === undefined) return fail(`ls: no folder called ${args[0] ?? ""}`);
        const listed = await listDriveFiles({ folderId: target });
        if (!listed.ok) return fail(`ls: ${listed.error.message}`);
        const inside = folders
          .filter((entry) => entry.parentId === target)
          .map((entry) => `${entry.name}/`);
        const files = listed.data.files.map(
          (file) => `${file.name}${file.status === "clean" ? "" : "  (quarantined)"}`,
        );
        return inside.length + files.length === 0 ? out("(empty)") : out(...inside, ...files);
      }
      case "cd": {
        const target = resolve(args[0] ?? "/");
        if (target === undefined) return fail(`cd: no folder called ${args[0] ?? ""}`);
        setFolder(target);
        return [];
      }
      case "mkdir": {
        if (!args[0]) return fail("mkdir: give the folder a name");
        const made = await createFolder({ name: args[0], parentId: folder, space: "personal" });
        if (!made.ok) return fail(`mkdir: ${made.error.message}`);
        setFolders((current) => [...current, made.data]);
        return [];
      }
      case "cat": {
        if (!args[0]) return fail("cat: which file?");
        const file = await fileHere(args[0]);
        if (!file) return fail(`cat: no file called ${args[0]} here`);
        if (file.contentType !== "text/plain") return fail(`cat: ${file.name} isn't text`);
        const text = await readDriveText(file.id);
        if (!text.ok) return fail(`cat: ${text.error.message}`);
        const shown = text.data.split("\n");
        return out(
          ...shown.slice(0, 400),
          ...(shown.length > 400 ? ["… (open it in Notepad to see the rest)"] : []),
        );
      }
      case "rm": {
        if (!args[0]) return fail("rm: which file?");
        const file = await fileHere(args[0]);
        if (!file) return fail(`rm: no file called ${args[0]} here`);
        const removed = await deleteFile(file.id);
        return removed.ok ? out(`${file.name} is in Trash.`) : fail(`rm: ${removed.error.message}`);
      }
      case "open": {
        const name = args.join(" ");
        if (!name) return fail("open: a file here, or an app");
        const app = appIds.find(
          (id) => id === name.toLowerCase() || apps[id].name.toLowerCase() === name.toLowerCase(),
        );
        if (app && isAppId(app)) {
          window.openApp(app);
          return out(`Opened ${apps[app].name}.`);
        }
        const file = await fileHere(name);
        if (!file) return fail(`open: no app or file called ${name}`);
        const opener = appFor(file);
        if (!opener) return fail(`open: no app opens ${file.name}`);
        window.openApp(opener, { file: file.id, name: file.name });
        return out(`Opened ${file.name} in ${apps[opener].name}.`);
      }
      case "browsers": {
        const overview = await fetchBrowserOverview();
        if (!overview.ok) return fail(`browsers: ${overview.error.message}`);
        return overview.data.sessions.length === 0
          ? out("None open.")
          : out(
              ...overview.data.sessions.map(
                (session) =>
                  `${engineDetails[session.engine].short.padEnd(14)}since ${new Date(session.startedAt ?? session.createdAt).toLocaleTimeString()}`,
              ),
            );
      }
      case "start": {
        const engine = args[0]?.toLowerCase();
        if (!engine || !(browserEngines as readonly string[]).includes(engine)) {
          return fail(`start: one of ${browserEngines.join(", ")}`);
        }
        await launch(engine as BrowserEngine);
        return out(`Opening ${engineDetails[engine as BrowserEngine].short}…`);
      }
      case "end": {
        const which = args[0]?.toLowerCase();
        if (!which) return fail("end: a browser, or all");
        const overview = await fetchBrowserOverview();
        if (!overview.ok) return fail(`end: ${overview.error.message}`);
        const chosen = overview.data.sessions.filter(
          (session) => which === "all" || session.engine === which,
        );
        if (chosen.length === 0) return fail(`end: no ${which} open`);
        await Promise.all(chosen.map((session) => endBrowserSession(session.id)));
        return out(`Ended ${String(chosen.length)} session${chosen.length === 1 ? "" : "s"}.`);
      }
      case "storage": {
        const overview = await fetchDriveOverview();
        if (!overview.ok) return fail(`storage: ${overview.error.message}`);
        const { usedBytes, limitBytes, fileCount, fileLimit } = overview.data.usage;
        return out(
          `${(usedBytes / 1024 ** 2).toFixed(1)} MB of ${(limitBytes / 1024 ** 3).toFixed(1)} GB · ${String(fileCount)} of ${String(fileLimit)} files`,
        );
      }
      default:
        return fail(`${command}: not a Brawzer command. Type help.`);
    }
  }

  async function submit() {
    const line = input.trim();
    setInput("");
    back.current = 0;
    const prompt = `${user}@brawzer:${pathOf(folder)}$ ${line}`;
    if (!line) {
      setLines((current) => [...current, { kind: "command", text: prompt }]);
      return;
    }
    history.current.push(line);
    setLines((current) => [...current, { kind: "command", text: prompt }]);
    const [command = "", ...args] = words(line);
    setBusy(true);
    const output = await run(command.toLowerCase(), args);
    setBusy(false);
    if (command.toLowerCase() !== "clear") setLines((current) => [...current, ...output]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!busy) void submit();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const list = history.current;
      back.current = Math.max(
        0,
        Math.min(list.length, back.current + (event.key === "ArrowUp" ? 1 : -1)),
      );
      setInput(back.current === 0 ? "" : (list[list.length - back.current] ?? ""));
    } else if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      setLines([]);
    }
  }

  return (
    // A click anywhere in the terminal puts the cursor in its line, as terminals do.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="ap-terminal" onClick={() => screen.current?.querySelector("input")?.focus()}>
      <div
        ref={screen}
        className="ap-terminal-screen"
        role="log"
        aria-label="Terminal output"
        aria-live="polite"
      >
        {lines.map((line, index) => (
          <pre key={index} data-kind={line.kind}>
            {line.text}
          </pre>
        ))}
        <label className="ap-terminal-line">
          <span aria-hidden="true">
            {user}@brawzer:{pathOf(folder)}$
          </span>
          <span className="sr-only">Command</span>
          <input
            value={input}
            disabled={busy}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            // The terminal is there to be typed into.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onChange={(event) => {
              setInput(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
      </div>
    </div>
  );
}
