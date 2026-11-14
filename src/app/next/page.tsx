import Link from "next/link";
import { notFound } from "next/navigation";
import { featureOn } from "@/lib/features";
import { LegalLinks } from "@/components/LegalLinks";
import { color, font } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const metadata = { title: "What's next · Lookout", robots: { index: false, follow: false } };

type Item = { title: string; body: string; status: "On staging" | "Building" | "Idea" };
const ITEMS: Item[] = [
  { title: "Events worth showing up to", status: "On staging", body: "The same search, pointed at meetups, panels and conferences where the people hiring for your next role will be. Each one gets a score and a reason, like a job find." },
  { title: "More than one search", status: "On staging", body: "Keep your job search, and add a second one next to it: freelance work, RFPs for your studio, an apartment, a car. One board each, same five-question setup." },
  { title: "Requests for proposals", status: "Building", body: "For freelancers and small agencies. Lookout reads public RFPs and puts the ones that fit your work and your rate on the board, with the deadline up front." },
  { title: "An inbox that sorts itself", status: "Idea", body: "Your own Lookout email address to put on applications. Lookout reads the replies, matches each one to its find, and tells you which ones need an answer." },
  { title: "Who to talk to", status: "Building", body: "For each find: the people at the company worth a message, and a short note you can edit and send yourself." },
  { title: "Your network, mapped to your finds", status: "Idea", body: "Import your contacts and see who you already know at the companies on your board, before you apply cold." },
];
const link = { color: color.brick, fontWeight: 600 } as const;
const tone = { "On staging": [color.greenText, "#E8F2E3"], Building: [color.peachInk, "#FCE3CC"], Idea: [color.t2, color.surface] } as const;

/** /next (#602): features still being built, for demos. 404 unless FEATURE_PREVIEW=on, so it comes down with one switch. */
export default function NextPage() {
  if (!featureOn("PREVIEW")) notFound();
  return (
    <main style={{ minHeight: "100vh", background: color.page, color: color.ink, padding: "40px 16px 48px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Link href="/" className="wordmark" style={{ fontSize: font["3xl"], color: color.ink, textDecoration: "none" }}>Lookout</Link>
        <div style={{ fontSize: font.sm, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.brick, marginTop: 48 }}>What&apos;s next</div>
        <h1 style={{ fontFamily: "var(--wordmark)", fontSize: "clamp(38px, 5.4vw, 64px)", lineHeight: 1, letterSpacing: "-0.03em", margin: "12px 0 0", maxWidth: "13em" }}>
          The same lookout, pointed at more things.
        </h1>
        <p style={{ fontSize: font.xl, lineHeight: 1.55, color: "#4A4339", maxWidth: "36em", marginTop: 18 }}>
          Jobs came first because a friend needed one. Underneath, Lookout is a search that reads, scores and explains. Here&apos;s where it goes next. Some of it
          works today on the test site, some of it is a sketch.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 40 }}>
          {ITEMS.map((it) => (
            <section key={it.title} style={{ background: "#fff", border: `1px solid ${color.border}`, borderRadius: 16, padding: 22 }}>
              <span style={{ fontSize: font.xs, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: tone[it.status][0], background: tone[it.status][1], borderRadius: 999, padding: "3px 10px" }}>{it.status}</span>
              <h2 style={{ fontSize: font["2xl"], fontWeight: 700, letterSpacing: "-0.01em", margin: "14px 0 0" }}>{it.title}</h2>
              <p style={{ fontSize: font.lg, lineHeight: 1.5, color: "#4A4339", margin: "8px 0 0" }}>{it.body}</p>
            </section>
          ))}
        </div>
        <div style={{ fontSize: font.lg, lineHeight: 1.6, color: "#4A4339", marginTop: 40 }}>
          <p style={{ margin: 0 }}>
            Want one of these first? <a href="mailto:ericdevlin@me.com?subject=Lookout" style={link}>Tell Eric.</a>
          </p>
          <p style={{ margin: "6px 0 0" }}>
            Got your own idea? <a href="https://github.com/ericseandevlin/lookout/issues/new?template=idea.yml" style={link}>Add it on GitHub</a>, or{" "}
            <a href="https://github.com/ericseandevlin/lookout/blob/main/CONTRIBUTING.md" style={link}>build it with me</a>. Lookout is open source.
          </p>
        </div>
        <LegalLinks style={{ marginTop: 28 }} />
      </div>
    </main>
  );
}
