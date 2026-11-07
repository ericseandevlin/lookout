import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchPage, pageToText } from "@/lib/ai/fetchPage";

/**
 * Read a link the user added (portfolio, site, writing) and keep its text so
 * searches can use it. Sites that block apps or render everything in
 * JavaScript come back thin; those are marked so the user knows.
 */
export async function readLink(materialId: string, url: string) {
  await db.update(schema.materials).set({ status: "scanning", filledNote: null }).where(eq(schema.materials.id, materialId));
  try {
    const { html } = await fetchPage(url);
    const text = pageToText(html, 4000);
    // The <title> also shows up in the page text; a page with only a title isn't enough to use.
    const title = text.match(/^TITLE: (.*)$/m)?.[1] ?? "";
    const body = text.replace(/^TITLE:.*$/m, "").replace(/TEXT:\s*/, "").replace(title, "").trim();
    if (body.length < 200) throw new Error("There wasn't enough text on the page to use");
    await db
      .update(schema.materials)
      .set({ status: "done", extracted: { text }, scannedAt: new Date() })
      .where(eq(schema.materials.id, materialId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const note = /40[13]|429|999/.test(msg)
      ? "This site blocks apps from reading it"
      : /enough text/.test(msg)
        ? "Not enough text on the page to use"
        : "Couldn't open this page";
    await db.update(schema.materials).set({ status: "failed", filledNote: note, extracted: null }).where(eq(schema.materials.id, materialId));
  }
}
