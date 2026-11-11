"use client";

import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppWindow } from "./app-window";
import { preview, useDriveKind } from "./media";

/** PDF Viewer: the PDFs in Drive, shown by the browser's own viewer. */
export default function PdfViewerApp() {
  const window = useAppWindow();
  const pdfs = useDriveKind("pdfs");
  const [shown, setShown] = useState<string | null>(window.params.file ?? null);
  const current =
    pdfs?.find((pdf) => pdf.id === shown) ??
    (shown ? { id: shown, name: window.params.name ?? "PDF" } : undefined);
  const title = current?.name ?? null;
  const { setTitle } = window;
  useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);

  return (
    <div className="ap-split">
      <nav className="ap-side" aria-label="PDFs in Drive">
        {pdfs?.length === 0 && <p className="ap-note">No PDFs in Drive yet.</p>}
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
            <FileText aria-hidden="true" />
            <span className="truncate">{pdf.name}</span>
          </button>
        ))}
      </nav>
      {current ? (
        <iframe key={current.id} className="ap-pdf" title={current.name} src={preview(current)} />
      ) : (
        <p className="ap-empty">Choose a PDF on the left.</p>
      )}
    </div>
  );
}
