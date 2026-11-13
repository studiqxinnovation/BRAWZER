"use client";

import { Button } from "@brawzer/ui/components/button";
import { ChevronDown, ChevronUp, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { photoWallpaperUrl } from "@/lib/desktop";
import { useAppWindow } from "./app-window";
import { OpenFromDrive } from "./open-from-drive";
import { type Slide, type SlideDeck, templateById } from "./templates";
import { useDriveDocument } from "./use-drive-document";

const THEMES: readonly { id: SlideDeck["theme"]; name: string }[] = [
  { id: "night", name: "Night" },
  { id: "paper", name: "Paper" },
  { id: "ocean", name: "Ocean" },
  { id: "sunrise", name: "Sunrise" },
];

const LAYOUTS: readonly { id: Slide["layout"]; name: string }[] = [
  { id: "title", name: "Title" },
  { id: "bullets", name: "Title and points" },
  { id: "picture", name: "Picture" },
];

const newId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const blankSlide = (layout: Slide["layout"] = "bullets"): Slide => ({
  id: newId(),
  layout,
  title: "",
  body: "",
});

const emptyDeck = (): SlideDeck => ({
  version: 1,
  theme: "night",
  slides: [blankSlide("title")],
});

const UUID = /^[0-9a-f-]{36}$/i;
/** Never shown: a deck always has a slide. */
const NO_SLIDE: Slide = { id: "none", layout: "title", title: "", body: "" };

/** A saved deck, read back without trusting it: unknown shapes become an empty deck. */
export function parseDeck(text: string): SlideDeck {
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object") return emptyDeck();
    const deck = raw as Partial<SlideDeck>;
    const theme = THEMES.find((t) => t.id === deck.theme)?.id ?? "night";
    const slides = Array.isArray(deck.slides)
      ? deck.slides.flatMap((entry: unknown): Slide[] => {
          if (!entry || typeof entry !== "object") return [];
          const slide = entry as Partial<Slide>;
          const layout = LAYOUTS.find((l) => l.id === slide.layout)?.id ?? "bullets";
          const imageId =
            typeof slide.imageId === "string" && UUID.test(slide.imageId)
              ? slide.imageId
              : undefined;
          return [
            {
              id: newId(),
              layout,
              title: typeof slide.title === "string" ? slide.title : "",
              body: typeof slide.body === "string" ? slide.body : "",
              ...(imageId ? { imageId } : {}),
            },
          ];
        })
      : [];
    return { version: 1, theme, slides: slides.length ? slides : [blankSlide("title")] };
  } catch {
    return emptyDeck();
  }
}

/** One slide, drawn at any size: the frame scales its 960×540 design. */
function SlideView({
  slide,
  theme,
  width,
  className,
}: {
  slide: Slide;
  theme: SlideDeck["theme"];
  width: number;
  className?: string;
}) {
  const scale = width / 960;
  const lines = slide.body.split("\n").filter((line) => line.trim());
  return (
    <div
      className={`ap-sl-frame ${className ?? ""}`}
      data-theme={theme}
      style={{ width, height: width * (9 / 16) }}
    >
      <div
        className="ap-sl-canvas"
        data-layout={slide.layout}
        style={{ transform: `scale(${scale})` }}
      >
        {slide.layout === "picture" && slide.imageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ap-sl-picture" src={photoWallpaperUrl(slide.imageId)} alt="" />
        ) : null}
        {slide.layout === "picture" && !slide.imageId ? (
          <div className="ap-sl-picture ap-sl-picture-empty">Add a picture from Drive</div>
        ) : null}
        <div className="ap-sl-text">
          <h2 className="ap-sl-title">
            {slide.title || (slide.layout === "title" ? "Title" : "")}
          </h2>
          {slide.layout === "title" ? (
            lines[0] ? (
              <p className="ap-sl-sub">{lines[0]}</p>
            ) : null
          ) : lines.length ? (
            <ul className="ap-sl-points">
              {lines.map((line, index) => (
                <li key={index}>{line.replace(/^[-*•]\s*/, "")}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Full-screen presenting: arrows and Space step, Escape leaves. */
function Presentation({
  deck,
  start,
  onClose,
}: {
  deck: SlideDeck;
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [width, setWidth] = useState(960);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fit = () => {
      const node = root.current;
      if (!node) return;
      const w = node.clientWidth - 48;
      const h = node.clientHeight - 48;
      setWidth(Math.max(320, Math.min(w, h * (16 / 9))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  const last = deck.slides.length - 1;

  // The keys work wherever focus is: presenting takes the whole screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        setIndex((current) => Math.min(last, current + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Home") {
        setIndex(0);
      } else if (event.key === "End") {
        setIndex(last);
      }
    };
    globalThis.document.addEventListener("keydown", onKey);
    return () => {
      globalThis.document.removeEventListener("keydown", onKey);
    };
  }, [last, onClose]);

  const shown = deck.slides[index] ?? deck.slides[0];
  if (!shown) return null;

  return (
    <div
      ref={root}
      className="ap-sl-present"
      role="dialog"
      aria-label="Presentation"
      aria-modal="true"
    >
      <SlideView slide={shown} theme={deck.theme} width={width} />
      <button
        type="button"
        className="ap-sl-present-next"
        aria-label="Next slide"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        onClick={() => {
          setIndex((current) => Math.min(last, current + 1));
        }}
      />
      <div className="ap-sl-present-bar">
        <span aria-live="polite">
          Slide {index + 1} of {deck.slides.length}
        </span>
        <span className="ap-sl-present-hint">Arrow keys step · Esc leaves</span>
        <button type="button" className="ap-sl-present-exit" onClick={onClose}>
          End presentation
        </button>
      </div>
    </div>
  );
}

/** Slides: presentations with themes and pictures from Drive, kept in Drive as JSON. */
export default function SlidesApp() {
  const window = useAppWindow();
  const template = templateById(window.params.template);
  const [deck, setDeck] = useState<SlideDeck>(() =>
    template?.deck && !window.params.file
      ? { ...template.deck, slides: template.deck.slides.map((s) => ({ ...s, id: newId() })) }
      : emptyDeck(),
  );
  const [current, setCurrent] = useState(0);
  const [picking, setPicking] = useState<"deck" | "picture" | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(640);
  const stage = useRef<HTMLDivElement>(null);
  const document = useDriveDocument({
    defaultName: template ? `${template.name}.slides` : "Untitled presentation.slides",
    folder: "Documents",
    type: "text/plain",
    onLoad: (text) => {
      setDeck(parseDeck(text));
      setCurrent(0);
    },
  });

  useEffect(() => {
    const fit = () => {
      const node = stage.current;
      if (!node) return;
      const w = node.clientWidth - 32;
      const h = node.clientHeight - 32;
      setPreviewWidth(Math.max(240, Math.min(w, h * (16 / 9))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (stage.current) observer.observe(stage.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  const slide = deck.slides[Math.min(current, deck.slides.length - 1)] ?? NO_SLIDE;
  const index = Math.max(0, deck.slides.indexOf(slide));

  function update(change: (deck: SlideDeck) => SlideDeck) {
    setDeck(change);
    document.changed();
  }

  function patch(fields: Partial<Slide>) {
    update((d) => ({
      ...d,
      slides: d.slides.map((s) => (s.id === slide.id ? { ...s, ...fields } : s)),
    }));
  }

  function addSlide() {
    const added = blankSlide();
    update((d) => ({
      ...d,
      slides: [...d.slides.slice(0, index + 1), added, ...d.slides.slice(index + 1)],
    }));
    setCurrent(index + 1);
  }

  function deleteSlide() {
    if (deck.slides.length === 1) {
      patch({ title: "", body: "", imageId: undefined });
      return;
    }
    update((d) => ({ ...d, slides: d.slides.filter((s) => s.id !== slide.id) }));
    setCurrent(Math.max(0, index - 1));
  }

  function move(by: number) {
    const to = index + by;
    if (to < 0 || to >= deck.slides.length) return;
    update((d) => {
      const slides = [...d.slides];
      const [moved] = slides.splice(index, 1);
      if (!moved) return d;
      slides.splice(to, 0, moved);
      return { ...d, slides };
    });
    setCurrent(to);
  }

  function save() {
    void document.save(JSON.stringify(deck));
  }

  // Cmd/Ctrl+S saves while this window has the focus.
  const body = useRef<HTMLDivElement>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!body.current?.contains(globalThis.document.activeElement)) return;
      event.preventDefault();
      saveRef.current();
    };
    globalThis.document.addEventListener("keydown", onKey);
    return () => {
      globalThis.document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={body} className="ap-body">
      <div className="ap-toolbar">
        <label className="ap-field ap-inline">
          <span className="sr-only">Presentation name</span>
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
        <label className="sr-only" htmlFor={`${window.id}-theme`}>
          Theme
        </label>
        <select
          id={`${window.id}-theme`}
          className="ap-input ap-select"
          value={deck.theme}
          onChange={(event) => {
            update((d) => ({ ...d, theme: event.target.value as SlideDeck["theme"] }));
          }}
        >
          {THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name} theme
            </option>
          ))}
        </select>
        <Button size="sm" onClick={addSlide}>
          <Plus aria-hidden="true" />
          New slide
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          onClick={() => {
            setPicking("deck");
          }}
        >
          Open…
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setPresenting(true);
          }}
        >
          Present
        </Button>
        <Button size="sm" variant="primary" loading={document.saving} onClick={save}>
          Save to Drive
        </Button>
      </div>

      <div className="ap-split">
        <div className="ap-side ap-sl-rail" role="listbox" aria-label="Slides">
          {deck.slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === index}
              className="ap-sl-thumb"
              onClick={() => {
                setCurrent(i);
              }}
            >
              {/* The option's name says what the slide is; the number and picture are decoration. */}
              <span className="sr-only">{`Slide ${i + 1}${s.title ? `: ${s.title}` : ""}`}</span>
              <span className="ap-sl-thumb-n" aria-hidden="true">
                {i + 1}
              </span>
              <span aria-hidden="true" className="contents">
                <SlideView slide={s} theme={deck.theme} width={144} className="ap-sl-thumb-frame" />
              </span>
            </button>
          ))}
        </div>

        <div className="ap-col">
          <div ref={stage} className="ap-sl-stage">
            <SlideView slide={slide} theme={deck.theme} width={previewWidth} />
          </div>
          <div className="ap-sl-editor">
            <div className="ap-sl-editor-row">
              <label className="ap-field">
                <span className="ap-label">Layout</span>
                <select
                  className="ap-input ap-select"
                  value={slide.layout}
                  onChange={(event) => {
                    patch({ layout: event.target.value as Slide["layout"] });
                  }}
                >
                  {LAYOUTS.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}
                    </option>
                  ))}
                </select>
              </label>
              {slide.layout === "picture" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setPicking("picture");
                  }}
                >
                  <ImagePlus aria-hidden="true" />
                  {slide.imageId ? "Change picture" : "Picture from Drive"}
                </Button>
              ) : null}
              <span className="flex-1" />
              <button
                type="button"
                className="ap-tool"
                aria-label="Move slide up"
                title="Move slide up"
                disabled={index === 0}
                onClick={() => {
                  move(-1);
                }}
              >
                <ChevronUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ap-tool"
                aria-label="Move slide down"
                title="Move slide down"
                disabled={index === deck.slides.length - 1}
                onClick={() => {
                  move(1);
                }}
              >
                <ChevronDown aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ap-tool"
                aria-label="Delete slide"
                title="Delete slide"
                onClick={deleteSlide}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
            <label className="ap-field">
              <span className="ap-label">Title</span>
              <input
                className="ap-input"
                value={slide.title}
                placeholder={
                  slide.layout === "title" ? "The presentation's title" : "This slide's title"
                }
                onChange={(event) => {
                  patch({ title: event.target.value });
                }}
              />
            </label>
            <label className="ap-field">
              <span className="ap-label">
                {slide.layout === "title" ? "Subtitle" : "Points, one per line"}
              </span>
              <textarea
                className="ap-input ap-sl-body"
                rows={slide.layout === "title" ? 2 : 5}
                value={slide.body}
                onChange={(event) => {
                  patch({ body: event.target.value });
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="ap-statusbar">
        <span>
          Slide {index + 1} of {deck.slides.length}
        </span>
        <span>{document.doc.fileId && !document.dirty ? "Saved in Drive" : "Not saved yet"}</span>
      </div>

      <OpenFromDrive
        open={picking === "deck"}
        onOpenChange={(open) => {
          if (!open) setPicking(null);
        }}
        kind="text"
        accept={[".slides"]}
        title="Open a presentation"
        onChoose={(file) => {
          setPicking(null);
          void document.open(file.id, file.name);
        }}
      />
      <OpenFromDrive
        open={picking === "picture"}
        onOpenChange={(open) => {
          if (!open) setPicking(null);
        }}
        kind="images"
        title="Choose a picture"
        onChoose={(file) => {
          setPicking(null);
          patch({ imageId: file.id, layout: "picture" });
        }}
      />

      {presenting ? (
        <Presentation
          deck={deck}
          start={index}
          onClose={() => {
            setPresenting(false);
          }}
        />
      ) : null}
    </div>
  );
}
