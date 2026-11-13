"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  type CitationStyle,
  formatCitation,
  type Piece,
  plainText,
  type Source,
  type SourceKind,
  sortKey,
} from "./citation-format";
import { RecordStatus } from "./record-status";
import { newId, useAppRecord } from "./use-app-record";

const sourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["website", "book", "journal"]),
  authors: z.string(),
  year: z.string(),
  title: z.string(),
  container: z.string(),
  url: z.string(),
  accessed: z.string(),
  volume: z.string(),
  issue: z.string(),
  pages: z.string(),
});
const stateSchema = z.object({
  style: z.enum(["harvard", "apa", "mla"]),
  sources: z.array(sourceSchema),
});

const STYLES: { id: CitationStyle; label: string }[] = [
  { id: "harvard", label: "Harvard" },
  { id: "apa", label: "APA 7" },
  { id: "mla", label: "MLA 9" },
];

const KINDS: { id: SourceKind; label: string; container: string }[] = [
  { id: "website", label: "Web page", container: "Website" },
  { id: "book", label: "Book", container: "Publisher" },
  { id: "journal", label: "Journal article", container: "Journal" },
];

const todayIso = () => {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const blank = (kind: SourceKind): Source => ({
  kind,
  authors: "",
  year: "",
  title: "",
  container: "",
  url: "",
  accessed: kind === "website" ? todayIso() : "",
  volume: "",
  issue: "",
  pages: "",
});

function Reference({ pieces }: { pieces: readonly Piece[] }) {
  return (
    <>
      {pieces.map((piece, index) =>
        piece.italic ? <i key={index}>{piece.text}</i> : <span key={index}>{piece.text}</span>,
      )}
    </>
  );
}

/** References in Harvard, APA or MLA, and the list they go into. */
export default function CitationsApp() {
  const toast = useToast();
  const { value, update, loaded, save, retry } = useAppRecord("citations", "state", stateSchema, {
    style: "harvard",
    sources: [],
  });
  const [draft, setDraft] = useState<Source>(() => blank("website"));
  const style = value.style;
  const containerLabel = KINDS.find((entry) => entry.id === draft.kind)?.container ?? "Website";

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.add({ type: "success", title: `${what} copied` });
    } catch {
      toast.add({
        type: "error",
        title: "Couldn’t copy",
        description: "Select the text and copy it.",
      });
    }
  }

  const field = (
    name: keyof Source,
    label: string,
    extra: { placeholder?: string; type?: string; wide?: boolean } = {},
  ) => (
    <label className={extra.wide ? "ap-field ap-span" : "ap-field"}>
      <span>{label}</span>
      <input
        className="ap-input"
        type={extra.type ?? "text"}
        value={draft[name]}
        placeholder={extra.placeholder}
        onChange={(event) => {
          setDraft((current) => ({ ...current, [name]: event.target.value }));
        }}
      />
    </label>
  );

  const preview = formatCitation(draft, style);
  const list = [...value.sources].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <div className="ap-segment" role="radiogroup" aria-label="Referencing style">
          {STYLES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={style === entry.id}
              onClick={() => {
                update((current) => ({ ...current, style: entry.id }));
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ap-split ap-cite">
        <form
          method="post"
          className="ap-pane ap-grid-form"
          aria-label="New reference"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.title.trim()) return;
            update((current) => ({
              ...current,
              sources: [...current.sources, { ...draft, id: newId() }],
            }));
            setDraft(blank(draft.kind));
          }}
        >
          <div className="ap-segment ap-span" role="radiogroup" aria-label="Kind of source">
            {KINDS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={draft.kind === entry.id}
                onClick={() => {
                  setDraft((current) => ({
                    ...blank(entry.id),
                    authors: current.authors,
                    title: current.title,
                    year: current.year,
                  }));
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {field("authors", "Authors", { placeholder: "Smith, Jane; Lee, Ann", wide: true })}
          {field("title", "Title", { wide: true })}
          {field("container", containerLabel)}
          {field("year", "Year", { placeholder: "2026" })}
          {draft.kind === "journal" && (
            <>
              {field("volume", "Volume")}
              {field("issue", "Issue")}
              {field("pages", "Pages", { placeholder: "45-67" })}
            </>
          )}
          {draft.kind !== "book" &&
            field("url", "Address (URL)", { type: "url", wide: draft.kind === "website" })}
          {draft.kind === "website" && field("accessed", "Accessed", { type: "date" })}
          <div className="ap-span ap-preview" aria-live="polite">
            <span className="ap-preview-label">Preview</span>
            <p>
              <Reference pieces={preview} />
            </p>
          </div>
          <div className="ap-span flex gap-2">
            <Button type="submit" variant="primary" disabled={!draft.title.trim()}>
              <Plus aria-hidden="true" />
              Add to list
            </Button>
            <Button
              onClick={() => void copy(plainText(preview), "Reference")}
              disabled={!draft.title.trim()}
            >
              <Copy aria-hidden="true" />
              Copy
            </Button>
          </div>
        </form>
        <section className="ap-pane ap-pane-list" aria-labelledby="citations-list">
          <div className="ap-row">
            <h2 id="citations-list" className="ap-group-title">
              Reference list <span>{list.length}</span>
            </h2>
            <Button
              size="sm"
              disabled={list.length === 0}
              onClick={() =>
                void copy(
                  list.map((source) => plainText(formatCitation(source, style))).join("\n\n"),
                  "Reference list",
                )
              }
            >
              <Copy aria-hidden="true" />
              Copy all
            </Button>
          </div>
          {loaded !== "loading" && list.length === 0 ? (
            <p className="ap-empty">
              References you add appear here, in order, in the style you choose.
            </p>
          ) : (
            <ol className="ap-refs">
              {list.map((source) => (
                <li key={source.id}>
                  <p>
                    <Reference pieces={formatCitation(source, style)} />
                  </p>
                  <button
                    type="button"
                    className="ap-icon-button"
                    aria-label={`Remove ${source.title}`}
                    onClick={() => {
                      update((current) => ({
                        ...current,
                        sources: current.sources.filter((candidate) => candidate.id !== source.id),
                      }));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <RecordStatus save={save} loaded={loaded} onRetry={() => void retry()}>
        {STYLES.find((entry) => entry.id === style)?.label} style
      </RecordStatus>
    </div>
  );
}
