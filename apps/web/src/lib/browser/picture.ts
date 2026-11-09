/** Turns what the viewport shows into a file, on this device; nothing is sent from here. */

/** Draws `source` at most `maxWidth` wide and encodes it. Null when the browser can't. */
export function encodeCanvas(
  source: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
  quality: number,
  maxWidth: number,
): Promise<Blob | null> {
  let canvas = source;
  if (source.width > maxWidth) {
    canvas = document.createElement("canvas");
    canvas.width = maxWidth;
    canvas.height = Math.round((source.height * maxWidth) / source.width);
    const context = canvas.getContext("2d");
    if (!context) return Promise.resolve(null);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/** Smaller and smaller JPEGs until one fits `maxBytes`; null when none does. */
export async function fittingJpeg(
  source: HTMLCanvasElement,
  maxBytes: number,
): Promise<Blob | null> {
  for (const [quality, width] of [
    [0.82, 1600],
    [0.7, 1280],
    [0.55, 960],
  ] as const) {
    const blob = await encodeCanvas(source, "image/jpeg", quality, width);
    if (blob && blob.size <= maxBytes) return blob;
  }
  return null;
}

/** The base64 of a blob, without a data URL's prefix. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** "Screenshot of example.com, 2026-11-08 at 17.05.03.png": no characters Drive would change. */
export function screenshotName(host: string, at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  const place = host.replace(/[^A-Za-z0-9.-]/g, "") || "a page";
  return `Screenshot of ${place}, ${day} at ${time}.png`;
}
