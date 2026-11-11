"use client";

import type { DriveFile, DrivePhoneLink } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FileText, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";
import { drivePhoneLinkSchema } from "@brawzer/contracts";
import { useAppWindow } from "./app-window";
import { OpenFromDrive } from "./open-from-drive";

/**
 * Send to Phone: a QR code for a Drive file. The phone opens Brawzer's Drive
 * at the file, after signing in; the code itself gives nothing away.
 */
export default function SendToPhoneApp() {
  const window = useAppWindow();
  const [file, setFile] = useState<Pick<DriveFile, "id" | "name"> | null>(
    window.params.file ? { id: window.params.file, name: window.params.name ?? "File" } : null,
  );
  const [link, setLink] = useState<DrivePhoneLink | null>(null);
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<"text" | "images" | "pdfs" | "audio">("pdfs");

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void apiRequest(`/drive/files/${encodeURIComponent(file.id)}/phone-link`, {
      schema: drivePhoneLinkSchema,
    }).then((result) => {
      if (!cancelled && result.ok) setLink(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div className="ap-body">
      <div className="ap-main ap-phone">
        {file && link ? (
          <>
            {/* The QR code is drawn by the server as SVG; an image can't run it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="ap-qr"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qrSvg)}`}
              alt={`QR code for “${file.name}” in Drive`}
            />
            <p className="ap-phone-name">
              <FileText aria-hidden="true" className="inline size-4" /> {file.name}
            </p>
            <p className="ap-note">
              Scan it with your phone’s camera. It opens Drive at this file once you sign in to
              Brawzer there; without a sign-in it opens nothing.
            </p>
          </>
        ) : (
          <div className="ap-empty">
            <Smartphone aria-hidden="true" className="size-8" />
            <p>Choose a file in Drive to send to your phone.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className="ap-field ap-inline">
            <span>Kind</span>
            <select
              className="ap-input"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
              }}
            >
              <option value="pdfs">PDFs</option>
              <option value="images">Pictures</option>
              <option value="text">Text and documents</option>
              <option value="audio">Music</option>
            </select>
          </label>
          <Button
            variant="primary"
            onClick={() => {
              setPicking(true);
            }}
          >
            Choose a file…
          </Button>
        </div>
      </div>
      <OpenFromDrive
        open={picking}
        onOpenChange={setPicking}
        kind={kind}
        title="Send a file to your phone"
        onChoose={(chosen) => {
          setLink(null);
          setFile({ id: chosen.id, name: chosen.name });
        }}
      />
    </div>
  );
}
