"use client";

import type { DriveFile, DrivePhoneLink } from "@brawzer/contracts";
import { drivePhoneLinkSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";
import { useAppWindow } from "./app-window";
import { OpenFromDrive } from "./open-from-drive";
import { Tile } from "./registry";

/** What a QR code can hold and still scan easily on a phone. */
const MAX_TEXT = 900;

const svgImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Send to Phone, as the prototype's: a QR code for some text or a link
 * (drawn here, in this page: the text goes nowhere but into the code), or
 * for a Drive file (the phone opens Drive at the file once signed in; the
 * code itself gives nothing away).
 */
export default function SendToPhoneApp() {
  const window = useAppWindow();
  const [mode, setMode] = useState<"text" | "file">(window.params.file ? "file" : "text");
  const [text, setText] = useState("");
  const [textQr, setTextQr] = useState<{ svg: string; text: string } | null>(null);
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

  async function makeTextCode() {
    const value = text.trim();
    if (!value) return;
    const svg = await QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
    setTextQr({ svg, text: value });
  }

  const qr =
    mode === "text"
      ? textQr && { src: svgImage(textQr.svg), alt: "QR code for your text" }
      : file && link && { src: svgImage(link.qrSvg), alt: `QR code for “${file.name}” in Drive` };

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <span className="ap-segment" role="tablist" aria-label="What to send">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "text"}
            onClick={() => {
              setMode("text");
            }}
          >
            Text or link
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "file"}
            onClick={() => {
              setMode("file");
            }}
          >
            File from Drive
          </button>
        </span>
        <span className="flex-1" />
        <span className="ap-hint">Point your phone’s camera at the code</span>
      </div>
      <div
        className="ap-sp-body"
        role="tabpanel"
        aria-label={mode === "text" ? "Text or link" : "File from Drive"}
      >
        <div className="ap-sp-left">
          {mode === "text" ? (
            <>
              <label className="ap-field">
                <span>Text or link</span>
                <textarea
                  className="ap-input ap-sp-text"
                  value={text}
                  maxLength={MAX_TEXT}
                  placeholder="Paste a link, an address, a phone number or a note"
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
              </label>
              <span className="ap-row">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!text.trim()}
                  onClick={() => void makeTextCode()}
                >
                  Make QR code
                </Button>
                <span className="ap-hint">
                  {text.length} / {MAX_TEXT}
                </span>
              </span>
              <p className="ap-hint">
                The code holds your text, so it goes straight to your phone. Nothing is saved on
                this computer.
              </p>
            </>
          ) : (
            <>
              <p className="ap-sp-file">
                {file ? (
                  <>
                    <Tile glyph="file" colour="blue" size={22} /> {file.name}
                  </>
                ) : (
                  "Choose a file in Drive to send to your phone."
                )}
              </p>
              <span className="ap-row">
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
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setPicking(true);
                  }}
                >
                  Choose a file…
                </Button>
              </span>
              <p className="ap-hint">
                The phone opens Drive at this file once you sign in to Brawzer there; without a
                sign-in the code opens nothing.
              </p>
            </>
          )}
        </div>
        <div className="ap-sp-qr">
          {qr ? (
            // The QR code is SVG drawn here or by the server; as an image it can't run anything.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.src} alt={qr.alt} />
          ) : (
            <span className="ap-sp-ph">
              <Tile glyph="phone" colour="green" size={40} />
              The QR code appears here
            </span>
          )}
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
