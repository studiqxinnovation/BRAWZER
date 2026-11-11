"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FolderOpen,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Save,
  Strikethrough,
  Underline,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAppWindow } from "./app-window";
import { OpenFromDrive } from "./open-from-drive";
import { htmlDocument, sanitizeHtml } from "./sanitize-html";
import { templateById } from "./templates";
import { useDriveDocument } from "./use-drive-document";

type Command =
  | "bold"
  | "italic"
  | "underline"
  | "strikeThrough"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "justifyLeft"
  | "justifyCenter"
  | "justifyRight";

/** A toolbar button that keeps the page's selection when pressed. */
function Tool({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ap-tool"
      aria-label={label}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/** Writer: documents with headings, lists and emphasis, kept in Drive as HTML. */
export default function WriterApp() {
  const window = useAppWindow();
  const page = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState(0);
  const [picking, setPicking] = useState(false);
  const template = templateById(window.params.template);
  const document = useDriveDocument({
    defaultName: template ? `${template.name}.html` : "Untitled document.html",
    folder: "Documents",
    type: "text/html",
    onLoad: (text) => {
      if (page.current) page.current.innerHTML = sanitizeHtml(text);
      count();
    },
  });

  function count() {
    const text = page.current?.innerText.trim() ?? "";
    setWords(text ? text.split(/\s+/).length : 0);
  }

  // A template starts the page; it's a new document until saved.
  useEffect(() => {
    if (template?.html && page.current && !window.params.file) {
      page.current.innerHTML = sanitizeHtml(template.html);
      count();
    }
    // Once, when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(command: Command) {
    page.current?.focus();
    // execCommand still edits contenteditable in every browser.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    globalThis.document.execCommand(command);
    document.changed();
  }

  function block(tag: "H1" | "H2" | "P" | "BLOCKQUOTE") {
    page.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    globalThis.document.execCommand("formatBlock", false, tag);
    document.changed();
  }

  function save() {
    const body = sanitizeHtml(page.current?.innerHTML ?? "");
    const title = document.doc.name.replace(/\.html?$/i, "");
    void document.save(htmlDocument(title, body));
  }

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <label className="ap-field ap-inline">
          <span className="sr-only">Document name</span>
          <input
            className="ap-input ap-name"
            value={document.doc.name}
            onChange={(event) => {
              document.rename(event.target.value);
              document.changed();
            }}
          />
        </label>
        <span className="ap-tool-group" role="group" aria-label="Paragraph style">
          <Tool
            label="Title"
            icon={<Heading1 aria-hidden="true" />}
            onClick={() => {
              block("H1");
            }}
          />
          <Tool
            label="Heading"
            icon={<Heading2 aria-hidden="true" />}
            onClick={() => {
              block("H2");
            }}
          />
          <Tool
            label="Normal text"
            icon={<Pilcrow aria-hidden="true" />}
            onClick={() => {
              block("P");
            }}
          />
          <Tool
            label="Quote"
            icon={<Quote aria-hidden="true" />}
            onClick={() => {
              block("BLOCKQUOTE");
            }}
          />
        </span>
        <span className="ap-tool-group" role="group" aria-label="Text style">
          <Tool
            label="Bold"
            icon={<Bold aria-hidden="true" />}
            onClick={() => {
              run("bold");
            }}
          />
          <Tool
            label="Italic"
            icon={<Italic aria-hidden="true" />}
            onClick={() => {
              run("italic");
            }}
          />
          <Tool
            label="Underline"
            icon={<Underline aria-hidden="true" />}
            onClick={() => {
              run("underline");
            }}
          />
          <Tool
            label="Strikethrough"
            icon={<Strikethrough aria-hidden="true" />}
            onClick={() => {
              run("strikeThrough");
            }}
          />
        </span>
        <span className="ap-tool-group" role="group" aria-label="Lists and alignment">
          <Tool
            label="Bulleted list"
            icon={<List aria-hidden="true" />}
            onClick={() => {
              run("insertUnorderedList");
            }}
          />
          <Tool
            label="Numbered list"
            icon={<ListOrdered aria-hidden="true" />}
            onClick={() => {
              run("insertOrderedList");
            }}
          />
          <Tool
            label="Align left"
            icon={<AlignLeft aria-hidden="true" />}
            onClick={() => {
              run("justifyLeft");
            }}
          />
          <Tool
            label="Centre"
            icon={<AlignCenter aria-hidden="true" />}
            onClick={() => {
              run("justifyCenter");
            }}
          />
          <Tool
            label="Align right"
            icon={<AlignRight aria-hidden="true" />}
            onClick={() => {
              run("justifyRight");
            }}
          />
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          onClick={() => {
            setPicking(true);
          }}
        >
          <FolderOpen aria-hidden="true" />
          Open…
        </Button>
        <Button size="sm" variant="primary" loading={document.saving} onClick={save}>
          <Save aria-hidden="true" />
          Save to Drive
        </Button>
      </div>
      <div className="ap-desk">
        <div
          ref={page}
          className="ap-page"
          role="textbox"
          aria-multiline="true"
          aria-label="Document"
          tabIndex={0}
          contentEditable={!document.loading}
          suppressContentEditableWarning
          onInput={() => {
            document.changed();
            count();
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              save();
            }
          }}
          onPaste={(event) => {
            // Pasted text arrives plain: nothing pasted can bring styles or scripts.
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            globalThis.document.execCommand("insertText", false, text);
          }}
        />
      </div>
      <div className="ap-statusbar">
        <span>{words} words</span>
        <span>
          {document.doc.fileId
            ? document.dirty
              ? "Not saved yet"
              : "Saved in Drive"
            : "Not in Drive yet"}{" "}
          · HTML
        </span>
      </div>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind="text"
        accept={[".html", ".htm", ".txt", ".md"]}
        title="Open a document"
        onChoose={(file) => void document.open(file.id, file.name)}
      />
    </div>
  );
}
