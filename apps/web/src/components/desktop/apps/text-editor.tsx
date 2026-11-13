"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { type KeyboardEvent, useRef, useState } from "react";
import { OpenFromDrive } from "./open-from-drive";
import { useDriveDocument } from "./use-drive-document";

const LANGUAGES: Record<string, string> = {
  js: "JavaScript",
  mjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript (JSX)",
  jsx: "JavaScript (JSX)",
  py: "Python",
  java: "Java",
  c: "C",
  h: "C",
  cpp: "C++",
  cs: "C#",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  md: "Markdown",
  sql: "SQL",
  sh: "Shell",
  yml: "YAML",
  yaml: "YAML",
  txt: "Plain text",
};

const languageOf = (name: string) =>
  LANGUAGES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "Plain text";

/**
 * Notepad and Code: plain text kept in Drive. Code adds line numbers,
 * indenting with Tab and Shift+Tab, keeping the indent on a new line, and
 * the language from the file's name.
 */
export function TextEditor({ variant }: { variant: "notepad" | "code" }) {
  const toast = useToast();
  const code = variant === "code";
  const [text, setText] = useState("");
  const [wrap, setWrap] = useState(!code);
  const [size, setSize] = useState(13);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [picking, setPicking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const document = useDriveDocument({
    defaultName: code ? "untitled.js" : "Untitled.txt",
    folder: code ? "Code" : "Notes",
    type: "text/plain",
    onLoad: (loaded) => {
      setText(loaded);
    },
  });
  const { doc } = document;
  const lines = text.split("\n").length;

  function track() {
    const element = area.current;
    if (!element) return;
    const before = element.value.slice(0, element.selectionStart);
    setPosition({
      line: before.split("\n").length,
      column: before.length - before.lastIndexOf("\n"),
    });
  }

  function edit(next: string, cursor: number) {
    setText(next);
    document.changed();
    requestAnimationFrame(() => {
      area.current?.setSelectionRange(cursor, cursor);
      track();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = element;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void document.save(text);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const indent = code ? "  " : "\t";
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      if (event.shiftKey) {
        const line = value.slice(lineStart);
        const removed = line.startsWith(indent) ? indent.length : line.startsWith("\t") ? 1 : 0;
        if (removed)
          edit(
            value.slice(0, lineStart) + value.slice(lineStart + removed),
            Math.max(lineStart, start - removed),
          );
        return;
      }
      edit(value.slice(0, start) + indent + value.slice(end), start + indent.length);
      return;
    }
    if (code && event.key === "Enter") {
      event.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const indent = /^[\t ]*/.exec(value.slice(lineStart, start))?.[0] ?? "";
      const extra = /[{[(:]\s*$/.test(value.slice(lineStart, start)) ? "  " : "";
      const insert = `\n${indent}${extra}`;
      edit(value.slice(0, start) + insert + value.slice(end), start + insert.length);
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ type: "success", title: "Copied" });
    } catch {
      toast.add({
        type: "error",
        title: "Couldn’t copy",
        description: "Select the text and copy it.",
      });
    }
  }

  return (
    <div className="ap-body" data-editor={variant}>
      <div className="ap-toolbar">
        <label className="ap-field ap-inline">
          <span className="sr-only">File name</span>
          <input
            className="ap-input ap-name"
            value={doc.name}
            onChange={(event) => {
              document.rename(event.target.value);
              document.changed();
            }}
          />
        </label>
        <Button
          size="sm"
          onClick={() => {
            setPicking(true);
          }}
        >
          Open…
        </Button>
        <span className="flex-1" />
        <button
          type="button"
          className="ap-tool"
          aria-pressed={wrap}
          onClick={() => {
            setWrap((current) => !current);
          }}
        >
          Wrap
        </button>
        <button
          type="button"
          className="ap-tool"
          aria-label="A−, smaller text"
          onClick={() => {
            setSize((current) => Math.max(10, current - 1));
          }}
        >
          A−
        </button>
        <button
          type="button"
          className="ap-tool"
          aria-label="A+, bigger text"
          onClick={() => {
            setSize((current) => Math.min(24, current + 1));
          }}
        >
          A+
        </button>
        <Button size="sm" onClick={() => void copyAll()}>
          Copy
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={document.saving}
          onClick={() => void document.save(text)}
        >
          Save to Drive
        </Button>
      </div>
      <div className="ap-editor">
        {code && (
          <div ref={gutter} className="ap-gutter" aria-hidden="true" style={{ fontSize: size }}>
            {Array.from({ length: lines }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          className="ap-textarea"
          aria-label={code ? "Code" : "Text"}
          spellCheck={!code}
          wrap={wrap ? "soft" : "off"}
          style={{ fontSize: size, whiteSpace: wrap ? "pre-wrap" : "pre" }}
          value={text}
          disabled={document.loading}
          placeholder={document.loading ? "Opening…" : code ? "" : "Start typing…"}
          onChange={(event) => {
            setText(event.target.value);
            document.changed();
            track();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={track}
          onClick={track}
          onScroll={(event) => {
            if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>
      <div className="ap-statusbar">
        <span>
          Ln {position.line}, Col {position.column}
          {code ? ` · ${languageOf(doc.name)}` : ""}
        </span>
        <span>
          {text.length} characters · {lines} lines ·{" "}
          {doc.fileId ? (document.dirty ? "Not saved yet" : "Saved in Drive") : "Not in Drive yet"}
        </span>
      </div>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind="text"
        title={code ? "Open code" : "Open a text file"}
        onChoose={(file) => void document.open(file.id, file.name)}
      />
    </div>
  );
}
