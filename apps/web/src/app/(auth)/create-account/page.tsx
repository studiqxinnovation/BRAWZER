import { Mark } from "@brawzer/ui/brand";
import type { Metadata } from "next";
import { CreateAccountForm } from "@/components/auth/create-account-form";
import { GlyphTile } from "@/components/glyph-tile";
import "./create-account.css";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a Brawzer account for your cloud browser, profiles and Drive.",
  robots: { index: false, follow: false },
};

/** Things that are true of every account from the first minute. */
const FACTS = [
  { glyph: "globe", colour: "teal", text: "Pages open on Brawzer’s servers, never on this device" },
  { glyph: "folder", colour: "blue", text: "Files in Drive are encrypted before they are stored" },
  { glyph: "shield", colour: "indigo", text: "Every sign-in and change is listed in Shield" },
  { glyph: "key", colour: "orange", text: "Passkeys and two-factor, from day one" },
] as const;

/**
 * The front door for new people: an introduction on the left, the form on the
 * right. The introduction says only what Brawzer does today.
 */
export default function CreateAccountPage() {
  return (
    <div className="w-full max-w-5xl">
      <div className="grid overflow-hidden rounded-2xl border border-line bg-surface shadow-lg md:grid-cols-[1.05fr_1fr]">
        <aside className="ca-panel flex flex-col gap-7 p-8 sm:p-10">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <Mark size={22} />
            </span>
            <span className="ca-eyebrow">Brawzer</span>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="ca-title">Your computer, in the cloud.</h2>
            <p className="ca-lead text-callout">
              Browsers that open in an isolated container, Drive for your files and a desktop of
              apps, reached from any device. Nothing stays on the one in front of you.
            </p>
          </div>
          {/* On a phone the form comes first; the facts wait for a wider screen. */}
          <ul className="ca-facts hidden md:grid">
            {FACTS.map((fact) => (
              <li key={fact.text}>
                <GlyphTile glyph={fact.glyph} colour={fact.colour} size={28} />
                <span>{fact.text}</span>
              </li>
            ))}
          </ul>
          <div className="ca-foot mt-auto hidden md:flex">
            <span>Free to start. No card needed.</span>
          </div>
        </aside>
        <section className="p-8 sm:p-10">
          <CreateAccountForm />
        </section>
      </div>
    </div>
  );
}
