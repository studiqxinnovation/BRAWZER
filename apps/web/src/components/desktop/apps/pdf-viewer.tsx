"use client";

import { Button } from "@brawzer/ui/components/button";
import { useEffect, useState } from "react";
import { useAppWindow } from "./app-window";
import { EmptyState } from "./empty-state";
import { preview, useDriveKind } from "./media";
import { OpenFromDrive } from "./open-from-drive";
import { Tile } from "./registry";

/**
 * PDF Viewer, laid out as the prototype's: the PDF's name and Open… along
 * the top, the PDFs in Drive down the side, and the document shown by the
 * browser's own viewer (which zooms, searches and prints).
 */
export default function PdfViewerApp() {
  const window = useAppWindow();
  const pdfs = useDriveKind("pdfs");
  const [shown, setShown] = useState<string | null>(window.params.file ?? null);
  const [picking, setPicking] = useState(false);
  const current =
    pdfs?.find((pdf) => pdf.id === shown) ??
    (shown ? { id: shown, name: window.params.name ?? "PDF" } : undefined);
  const title = current?.name ?? null;
  const { setTitle } = window;
  useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <h2 className="ap-place">{current ? current.name : "No PDF open"}</h2>
        <span className="flex-1" />
        <Button
          size="sm"
          onClick={() => {
            setPicking(true);
          }}
        >
          Open…
        </Button>
      </div>
      <div className="ap-split">
        {(pdfs?.length ?? 0) > 0 && (
          <nav className="ap-side" aria-label="PDFs in Drive">
            <span className="ap-side-h" aria-hidden="true">
              In your Drive
            </span>
            {pdfs?.map((pdf) => (
              <button
                key={pdf.id}
                type="button"
                className="ap-side-item"
                aria-current={shown === pdf.id ? "page" : undefined}
                onClick={() => {
                  setShown(pdf.id);
                }}
              >
                <Tile glyph="file" colour="red" size={20} />
                <span className="truncate">{pdf.name}</span>
              </button>
            ))}
          </nav>
        )}
        {current ? (
          <iframe key={current.id} className="ap-pdf" title={current.name} src={preview(current)} />
        ) : (
          <EmptyState
            glyph="file"
            colour="red"
            title="Open a PDF"
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setPicking(true);
                }}
              >
                Choose a PDF…
              </Button>
            }
          >
            {(pdfs?.length ?? 0) > 0
              ? "Choose one on the left, or from anywhere in your Drive."
              : "No PDFs in your Drive yet. Upload one in Files, or save a page from a cloud browser as a PDF."}
          </EmptyState>
        )}
      </div>
      <div className="ap-statusbar">
        <span>{current ? "Shown by the browser’s own PDF viewer" : "Open a PDF to start"}</span>
      </div>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind="pdfs"
        title="Open a PDF"
        onChoose={(file) => {
          setShown(file.id);
        }}
      />
    </div>
  );
}
