/**
 * PowerPoint presentations (.pptx) in and out of Slides. In: each slide's
 * title, text and first picture become a Slides slide. Out: a 16:9 deck
 * in the chosen theme, with real title and body text and the pictures
 * embedded, which PowerPoint, Keynote and LibreOffice open.
 */
import type { Slide, SlideDeck } from "../templates";
import {
  attribute,
  contentTypesXml,
  descendants,
  escapeXml,
  kid,
  PACKAGE_RELS,
  type Parts,
  partXml,
  readParts,
  readRelationships,
  relationshipsXml,
  resolvePart,
  writeParts,
  XML_HEAD,
} from "./package-xml";

export interface ImportedSlide {
  layout: Slide["layout"];
  title: string;
  body: string;
  /** The slide's first picture, to be kept in Drive. */
  picture?: { bytes: Uint8Array<ArrayBuffer>; type: string; name: string };
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The slide parts in presentation order. */
function slidePaths(parts: Parts): string[] {
  const presentation = partXml(parts, "ppt/presentation.xml");
  const relationships = readRelationships(parts, "ppt/_rels/presentation.xml.rels");
  const ordered = presentation
    ? descendants(presentation, "sldId").flatMap((entry) => {
        const relationship = Array.from(entry.attributes).find(
          (candidate) => candidate.localName === "id" && candidate.prefix === "r",
        );
        const target = relationship ? relationships.get(relationship.value) : undefined;
        const path = target ? resolvePart(parts, "ppt/", target) : null;
        return path ? [path] : [];
      })
    : [];
  if (ordered.length) return ordered;
  return Object.keys(parts)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
}

/** A shape's text, one line per paragraph. */
function textOf(shape: Element): string {
  return descendants(shape, "p")
    .filter((paragraph) => paragraph.namespaceURI?.includes("drawingml"))
    .map((paragraph) =>
      Array.from(paragraph.children)
        .map((child) => {
          if (child.localName === "r" || child.localName === "fld") {
            return kid(child, "t")?.textContent ?? "";
          }
          return child.localName === "br" ? "\n" : "";
        })
        .join(""),
    )
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function placeholderType(shape: Element): string | null {
  const nv = kid(shape, "nvSpPr");
  const properties = nv ? kid(nv, "nvPr") : undefined;
  const placeholder = properties ? kid(properties, "ph") : undefined;
  if (!placeholder) return null;
  return attribute(placeholder, "type") ?? "body";
}

/** The slides of a presentation, or null when it isn't one. */
export function pptxToSlides(bytes: Uint8Array): ImportedSlide[] | null {
  const parts = readParts(bytes);
  if (!parts) return null;
  if (!("ppt/presentation.xml" in parts)) return null;
  const slides: ImportedSlide[] = [];
  for (const path of slidePaths(parts)) {
    const xml = partXml(parts, path);
    if (!xml) continue;
    const relsPath = path.replace(/^ppt\/slides\/(.+)$/, "ppt/slides/_rels/$1.rels");
    const relationships = readRelationships(parts, relsPath);
    let title = "";
    let subtitle = "";
    const lines: string[] = [];
    for (const shape of descendants(xml, "sp")) {
      const text = textOf(shape);
      if (!text) continue;
      const type = placeholderType(shape);
      if (type === "title" || type === "ctrTitle") {
        if (!title) title = text.replace(/\n/g, " ");
        else lines.push(text);
      } else if (type === "subTitle") subtitle = subtitle ? `${subtitle}\n${text}` : text;
      else if (type === "dt" || type === "ftr" || type === "sldNum") continue;
      else lines.push(text);
    }
    if (!title && lines.length) title = (lines.shift() ?? "").replace(/\n/g, " ");
    let picture: ImportedSlide["picture"];
    const pic = descendants(xml, "pic")[0];
    const blip = pic ? descendants(pic, "blip")[0] : undefined;
    const embed = blip
      ? Array.from(blip.attributes).find((a) => a.localName === "embed")?.value
      : undefined;
    const target = embed ? relationships.get(embed) : undefined;
    const mediaPath = target ? resolvePart(parts, "ppt/slides/", target) : null;
    const media = mediaPath ? parts[mediaPath] : undefined;
    const extension = mediaPath?.split(".").pop()?.toLowerCase() ?? "";
    const mediaType = MEDIA_TYPES[extension];
    if (media && mediaType && mediaPath) {
      picture = {
        bytes: new Uint8Array(media),
        type: mediaType,
        name: mediaPath.split("/").pop() ?? "picture",
      };
    }
    const body = picture
      ? [subtitle, ...lines].filter(Boolean).join("\n")
      : lines.length
        ? lines.join("\n")
        : subtitle;
    slides.push({
      layout: picture ? "picture" : lines.length ? "bullets" : "title",
      title,
      body,
      ...(picture ? { picture } : {}),
    });
  }
  return slides;
}

/* ---------- Writing ---------- */

export interface Picture {
  bytes: Uint8Array;
  type: string;
  width: number;
  height: number;
}

interface Palette {
  /** Top and bottom of the background gradient. */
  from: string;
  to: string;
  ink: string;
  accent: string;
}

const PALETTES: Readonly<Record<SlideDeck["theme"], Palette>> = {
  night: { from: "15161C", to: "262A3A", ink: "F4F5F8", accent: "8FB4FF" },
  paper: { from: "FAF7F0", to: "FAF7F0", ink: "1C1B19", accent: "B4532D" },
  ocean: { from: "0A3D62", to: "1B6FA8", ink: "F2F8FC", accent: "8EE3D6" },
  sunrise: { from: "FFF1DC", to: "FFD1C2", ink: "3A2418", accent: "D9480F" },
};

/** English Metric Units: 914400 to the inch; the slide is 13.333 by 7.5 inches. */
const INCH = 914400;
const WIDTH = 12192000;
const HEIGHT = 6858000;

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const PRESENTATION_XML = "application/vnd.openxmlformats-officedocument.presentationml";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const box = (x: number, y: number, width: number, height: number) =>
  `<a:xfrm><a:off x="${String(Math.round(x))}" y="${String(Math.round(y))}"/><a:ext cx="${String(Math.round(width))}" cy="${String(Math.round(height))}"/></a:xfrm>`;

let shapeIds = 1;

/** A text box: one paragraph per line, bulleted when asked. */
function textShape(
  name: string,
  frame: string,
  lines: readonly string[],
  options: {
    size: number;
    bold?: boolean;
    colour: string;
    align?: "ctr" | "l";
    bullets?: boolean;
    anchor?: "t" | "ctr" | "b";
    /** What the shape is to PowerPoint, so the text reads back as that. */
    placeholder: "title" | "subTitle" | "body";
  },
): string {
  shapeIds += 1;
  const paragraphs = (lines.length ? lines : [""])
    .map((line) => {
      const properties = `<a:pPr algn="${options.align ?? "l"}"${options.bullets ? "" : ' marL="0" indent="0"'}>${
        options.bullets
          ? `<a:spcBef><a:spcPts val="600"/></a:spcBef><a:buClr><a:srgbClr val="${options.colour}"/></a:buClr><a:buChar char="&#8226;"/>`
          : "<a:buNone/>"
      }</a:pPr>`;
      const run = `<a:r><a:rPr lang="en-GB" sz="${String(options.size * 100)}"${options.bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${options.colour}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${escapeXml(line)}</a:t></a:r>`;
      return `<a:p>${properties}${run}</a:p>`;
    })
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${String(shapeIds)}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="${options.placeholder}"${options.placeholder === "body" ? ' idx="1"' : ""}/></p:nvPr></p:nvSpPr><p:spPr>${frame}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${options.anchor ?? "t"}" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function pictureShape(frame: string, relationshipId: string): string {
  shapeIds += 1;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${String(shapeIds)}" name="Picture"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${frame}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** A picture fitted inside a box, keeping its shape, centred. */
function fitted(picture: Picture, x: number, y: number, width: number, height: number): string {
  const ratio = picture.width > 0 && picture.height > 0 ? picture.width / picture.height : 16 / 9;
  let drawnWidth = width;
  let drawnHeight = width / ratio;
  if (drawnHeight > height) {
    drawnHeight = height;
    drawnWidth = height * ratio;
  }
  return box(x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function slideXml(slide: Slide, palette: Palette, picture: Picture | null): string {
  const lines = slide.body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const margin = 0.6 * INCH;
  const inner = WIDTH - 2 * margin;
  let shapes = "";
  if (slide.layout === "title") {
    shapes +=
      textShape("Title", box(margin, 2.1 * INCH, inner, 1.8 * INCH), [slide.title], {
        size: 54,
        bold: true,
        colour: palette.ink,
        align: "ctr",
        anchor: "b",
        placeholder: "title",
      }) +
      textShape("Subtitle", box(margin, 4.0 * INCH, inner, 1.4 * INCH), lines, {
        size: 24,
        colour: palette.accent,
        align: "ctr",
        placeholder: "subTitle",
      });
  } else if (slide.layout === "picture") {
    shapes += textShape("Title", box(margin, 0.4 * INCH, inner, 1.0 * INCH), [slide.title], {
      size: 32,
      bold: true,
      colour: palette.ink,
      anchor: "ctr",
      placeholder: "title",
    });
    if (picture)
      shapes += pictureShape(fitted(picture, margin, 1.5 * INCH, inner, 4.8 * INCH), "rId2");
    shapes += textShape("Caption", box(margin, 6.4 * INCH, inner, 0.7 * INCH), lines, {
      size: 16,
      colour: palette.accent,
      align: "ctr",
      placeholder: "body",
    });
  } else {
    shapes +=
      textShape("Title", box(margin, 0.5 * INCH, inner, 1.2 * INCH), [slide.title], {
        size: 36,
        bold: true,
        colour: palette.ink,
        anchor: "ctr",
        placeholder: "title",
      }) +
      textShape("Points", box(margin, 1.9 * INCH, inner, 5.0 * INCH), lines, {
        size: 24,
        colour: palette.ink,
        bullets: true,
        placeholder: "body",
      });
  }
  const background = `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${palette.from}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${palette.to}"/></a:gs></a:gsLst><a:lin ang="4800000" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`;
  return `${XML_HEAD}<p:sld ${P} ${A} ${R}><p:cSld>${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

const MASTER = `${XML_HEAD}<p:sldMaster ${P} ${A} ${R}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${XML_HEAD}<p:sldLayout ${P} ${A} ${R} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const fill = (colour: string) => `<a:solidFill><a:schemeClr val="${colour}"/></a:solidFill>`;
const line = (width: number) =>
  `<a:ln w="${String(width)}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;

function themeXml(palette: Palette): string {
  const scheme = [
    ["dk1", "1C1B19"],
    ["lt1", "FFFFFF"],
    ["dk2", palette.ink],
    ["lt2", palette.from],
    ["accent1", palette.accent],
    ["accent2", "8FB4FF"],
    ["accent3", "8EE3D6"],
    ["accent4", "D9480F"],
    ["accent5", "B4532D"],
    ["accent6", "262A3A"],
    ["hlink", palette.accent],
    ["folHlink", palette.accent],
  ]
    .map(
      ([name, colour]) => `<a:${name ?? ""}><a:srgbClr val="${colour ?? ""}"/></a:${name ?? ""}>`,
    )
    .join("");
  const font = (face: string) =>
    `<a:latin typeface="${face}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `${XML_HEAD}<a:theme ${A} name="Brawzer"><a:themeElements><a:clrScheme name="Brawzer">${scheme}</a:clrScheme><a:fontScheme name="Brawzer"><a:majorFont>${font("Calibri Light")}</a:majorFont><a:minorFont>${font("Calibri")}</a:minorFont></a:fontScheme><a:fmtScheme name="Brawzer"><a:fillStyleLst>${fill("phClr")}${fill("phClr")}${fill("phClr")}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill("phClr")}${fill("phClr")}${fill("phClr")}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

/**
 * A presentation from a deck. Pictures come through `loadPicture`, which
 * may say a picture is gone (null): that slide then has its caption only.
 */
export async function deckToPptx(
  deck: SlideDeck,
  loadPicture: (fileId: string) => Promise<Picture | null>,
): Promise<Uint8Array<ArrayBuffer>> {
  const palette = PALETTES[deck.theme];
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: Record<string, string> = {
    "/ppt/presentation.xml": `${PRESENTATION_XML}.presentation.main+xml`,
    "/ppt/slideMasters/slideMaster1.xml": `${PRESENTATION_XML}.slideMaster+xml`,
    "/ppt/slideLayouts/slideLayout1.xml": `${PRESENTATION_XML}.slideLayout+xml`,
    "/ppt/theme/theme1.xml": "application/vnd.openxmlformats-officedocument.theme+xml",
  };
  const defaults: Record<string, string> = {};
  const slideIds: string[] = [];
  const presentationRels = [
    { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    { id: "rId2", type: "theme", target: "theme/theme1.xml" },
  ];
  shapeIds = 1;
  for (const [index, slide] of deck.slides.entries()) {
    const n = index + 1;
    const picture =
      slide.layout === "picture" && slide.imageId ? await loadPicture(slide.imageId) : null;
    const extension = picture ? EXTENSIONS[picture.type] : undefined;
    const kept = picture && extension ? picture : null;
    parts[`ppt/slides/slide${String(n)}.xml`] = slideXml(slide, palette, kept);
    overrides[`/ppt/slides/slide${String(n)}.xml`] = `${PRESENTATION_XML}.slide+xml`;
    const relationships = [
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    ];
    if (kept && extension) {
      const media = `image${String(n)}.${extension}`;
      parts[`ppt/media/${media}`] = kept.bytes;
      defaults[extension] = kept.type;
      relationships.push({ id: "rId2", type: "image", target: `../media/${media}` });
    }
    parts[`ppt/slides/_rels/slide${String(n)}.xml.rels`] = relationshipsXml(relationships);
    const relationshipId = `rId${String(10 + n)}`;
    presentationRels.push({
      id: relationshipId,
      type: "slide",
      target: `slides/slide${String(n)}.xml`,
    });
    slideIds.push(`<p:sldId id="${String(255 + n)}" r:id="${relationshipId}"/>`);
  }
  const presentation = `${XML_HEAD}<p:presentation ${P} ${A} ${R} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds.join("")}</p:sldIdLst><p:sldSz cx="${String(WIDTH)}" cy="${String(HEIGHT)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-GB"/></a:defPPr></p:defaultTextStyle></p:presentation>`;
  return writeParts({
    "[Content_Types].xml": contentTypesXml(defaults, overrides),
    "_rels/.rels": PACKAGE_RELS.replace("%MAIN%", "ppt/presentation.xml"),
    "ppt/presentation.xml": presentation,
    "ppt/_rels/presentation.xml.rels": relationshipsXml(presentationRels),
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationshipsXml([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationshipsXml([
      { id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" },
    ]),
    "ppt/theme/theme1.xml": themeXml(palette),
    ...parts,
  });
}
