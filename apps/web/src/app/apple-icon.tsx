import { activeConcept, conceptSvgMarkup } from "@brawzer/ui/brand";
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon. iOS applies its own rounded mask, so the tile is full-bleed. */
export default function AppleIcon() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${conceptSvgMarkup(activeConcept, "#f8f7f4")}</svg>`;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1c1b19",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
      <img
        alt=""
        width={112}
        height={112}
        src={`data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`}
      />
    </div>,
    size,
  );
}
