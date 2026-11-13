"use client";

import { OFFICE_TYPES } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { AlignCenter, AlignLeft, List, ListOrdered, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAppWindow } from "./app-window";
import { OpenFromDrive } from "./open-from-drive";
import { docxToHtml, htmlToDocx } from "./office/docx";
import { htmlDocument, sanitizeHtml } from "./sanitize-html";
import { templateById } from "./templates";
import { useDriveDocument } from "./use-drive-document";

type Command =
  | "bold"
  | "italic"
  | "underline"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "justifyLeft"
  | "justifyCenter"
  | "undo";

type Block = "H1" | "H2" | "P" | "BLOCKQUOTE";

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

/** A Word document, by its name: opened from .docx and saved back as one. */
const isWord = (name: string) => /\.docx$/i.test(name);

/** Writer: documents with headings, lists and emphasis, kept in Drive as HTML or Word files. */
export default function WriterApp() {
  const window = useAppWindow();
  const page = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [words, setWords] = useState(0);
  const [characters, setCharacters] = useState(0);
  const [style, setStyle] = useState<Block>("P");
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
    binary: isWord,
    onLoadBytes: (bytes, name) => {
      const imported = docxToHtml(bytes);
      if (!imported) {
        toast.add({
          type: "error",
          title: `“${name}” isn’t a Word document`,
          description: "Only .docx files made by Word, Pages or LibreOffice open here.",
        });
        return;
      }
      if (page.current) page.current.innerHTML = sanitizeHtml(imported.html);
      count();
      if (imported.pictures > 0) {
        toast.add({
          type: "info",
          title: `${String(imported.pictures)} picture${imported.pictures === 1 ? "" : "s"} left out`,
          description: "Writer keeps the text, headings, lists and links of a Word file.",
        });
      }
    },
  });

  function count() {
    const text = page.current?.innerText.trim() ?? "";
    setWords(text ? text.split(/\s+/).length : 0);
    setCharacters(text.length);
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(page.current?.innerText ?? "");
      toast.add({ type: "success", title: "Text copied" });
    } catch {
      toast.add({
        type: "error",
        title: "Couldn’t copy",
        description: "The browser didn’t allow it.",
      });
    }
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

  function block(tag: Block) {
    page.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    globalThis.document.execCommand("formatBlock", false, tag);
    document.changed();
  }

  function save() {
    const body = sanitizeHtml(page.current?.innerHTML ?? "");
    if (isWord(document.doc.name)) {
      void document.save(htmlToDocx(body), undefined, OFFICE_TYPES.word);
      return;
    }
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
        <span className="ap-tb-sep" aria-hidden="true" />
        <label className="sr-only" htmlFor={`${window.id}-style`}>
          Paragraph style
        </label>
        <select
          id={`${window.id}-style`}
          className="ap-input ap-select"
          value={style}
          onChange={(event) => {
            const tag = event.target.value as Block;
            setStyle(tag);
            block(tag);
          }}
        >
          <option value="P">Body text</option>
          <option value="H1">Title</option>
          <option value="H2">Heading</option>
          <option value="BLOCKQUOTE">Quote</option>
        </select>
        <Tool
          label="Bold"
          icon={<b>B</b>}
          onClick={() => {
            run("bold");
          }}
        />
        <Tool
          label="Italic"
          icon={<i className="font-serif">I</i>}
          onClick={() => {
            run("italic");
          }}
        />
        <Tool
          label="Underline"
          icon={<u>U</u>}
          onClick={() => {
            run("underline");
          }}
        />
        <span className="ap-tb-sep" aria-hidden="true" />
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
          label="Undo"
          icon={<Undo2 aria-hidden="true" />}
          onClick={() => {
            run("undo");
          }}
        />
        <span className="flex-1" />
        <Button
          size="sm"
          onClick={() => {
            setPicking(true);
          }}
        >
          Open…
        </Button>
        <Button size="sm" onClick={() => void copyText()}>
          Copy text
        </Button>
        <Button size="sm" variant="primary" loading={document.saving} onClick={save}>
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
          data-placeholder="Start typing here. Use the toolbar for titles, headings, bold text and lists. When you’re done, save it to your Drive."
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
        <span>
          {words} words · {characters} characters
        </span>
        <span>
          {isWord(document.doc.name) ? "Word document · " : ""}
          {document.doc.fileId
            ? document.dirty
              ? "Not saved yet"
              : "Saved in Drive"
            : "Not saved yet"}
        </span>
      </div>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind={["text", "documents"]}
        accept={[".html", ".htm", ".txt", ".md", ".docx"]}
        title="Open a document"
        onChoose={(file) => void document.open(file.id, file.name)}
      />
    </div>
  );
}
