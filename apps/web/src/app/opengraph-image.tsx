import { activeConcept, conceptSvgMarkup } from "@brawzer/ui/brand";
import { ImageResponse } from "next/og";

export const alt = "Brawzer — Browse anywhere. Leave nothing behind.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social-share image. Uses the built-in image font until the public site (milestone 1.3). */
export default function OpenGraphImage() {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${conceptSvgMarkup(activeConcept, "#edebe7")}</svg>`;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "88px 96px",
        background: "#121211",
        color: "#edebe7",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img
          alt=""
          width={76}
          height={76}
          src={`data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`}
        />
        <span style={{ fontSize: 60, fontWeight: 600, letterSpacing: -2 }}>Brawzer</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <span style={{ fontSize: 72, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1.05 }}>
          Browse anywhere. Leave nothing behind.
        </span>
        <span style={{ fontSize: 30, color: "#a8a49e" }}>
          Your browser runs in the cloud. The computer in front of you is only a window to it.
        </span>
      </div>
    </div>,
    size,
  );
}
