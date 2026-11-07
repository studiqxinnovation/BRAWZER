import { Download, Eye, Folder, Gauge, Search, Upload } from "lucide-react";
import type { Metadata } from "next";
import { Callout, CtaBand, Steps } from "@/components/site/blocks";
import { DrivePanel } from "@/components/site/illustrations";
import { Container, PageHero, SectionIntro, SpecList } from "@/components/site/layout-primitives";

export const metadata: Metadata = {
  title: "Brawzer Drive",
  description:
    "Everything you download in Brawzer is saved to Brawzer Drive: scanned, organised and available on your next device, never left on the computer.",
  alternates: { canonical: "/drive" },
};

const features = [
  {
    icon: <Eye />,
    title: "Previews",
    description:
      "Open PDFs, images and documents right in Drive, without downloading them anywhere.",
  },
  {
    icon: <Folder />,
    title: "Folders",
    description: "Organise, rename and delete files, the way you would on your own computer.",
  },
  { icon: <Search />, title: "Search", description: "Find any file by name in a moment." },
  {
    icon: <Upload />,
    title: "Uploads to websites",
    description:
      "When a website asks for a file, choose it from Drive. Nothing needs to be on the computer.",
  },
  {
    icon: <Download />,
    title: "Save to this computer",
    description:
      "Only when you choose to, after confirming it’s you. Every export is recorded in your activity.",
  },
  { icon: <Gauge />, title: "Storage", description: "See how much space you use, file by file." },
];

export default function DrivePage() {
  return (
    <>
      <PageHero
        eyebrow="Brawzer Drive"
        title="Downloads that stay with you, not the computer."
        lede="Everything you download in Brawzer is saved to Brawzer Drive: scanned, organised and ready on your next device."
      >
        <DrivePanel className="max-w-lg" />
      </PageHero>

      <section
        aria-labelledby="drive-how-title"
        className="border-y border-line bg-canvas-subtle py-20 sm:py-28"
      >
        <Container>
          <SectionIntro
            id="drive-how-title"
            eyebrow="How it works"
            title="From a website to your Drive, never the disk."
          />
          <Steps
            className="mt-12"
            steps={[
              {
                title: "Download as usual",
                body: "Click a download link in your Brawzer browser, just as you would anywhere else.",
              },
              {
                title: "Saved to Drive and scanned",
                body: "The file goes to Brawzer Drive in the cloud and is checked for malware before you open it.",
              },
              {
                title: "Use it anywhere",
                body: "Preview it, upload it to another site, or open it on your next device.",
              },
            ]}
          />
        </Container>
      </section>

      <section aria-labelledby="drive-features-title" className="py-20 sm:py-28">
        <Container>
          <SectionIntro
            id="drive-features-title"
            eyebrow="Features"
            title="A file manager made for the cloud browser."
          />
          <SpecList className="mt-12" items={features} />
          <Callout className="mt-10 max-w-3xl">
            Malware scanning lowers the risk, but no scanner catches everything. For files from
            sources you don’t trust, preview them in Drive instead of saving them to a computer.
          </Callout>
        </Container>
      </section>

      <CtaBand
        title="Leave nothing on the computer."
        body="Your downloads wait for you in Drive, on whichever computer you use next."
        secondary={{ href: "/security", label: "Read about security" }}
      />
    </>
  );
}
