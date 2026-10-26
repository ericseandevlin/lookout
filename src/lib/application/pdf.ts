import "server-only";
import { launchChromium } from "./chromium";
import { docPage, type DocOpts } from "./docHtml";

/**
 * The resume or letter as a PDF, printed by Chromium from the same blocks as the review screen
 * (#106): real, selectable text in reading order, tagged, with the section headings as bookmarks, so
 * an ATS reads what the person approved. No images, no text boxes.
 */
export async function draftToPdf(md: string, o: DocOpts & { title: string }): Promise<Buffer> {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    // Nothing on the page loads from the network: the document is self-contained.
    await page.route("**/*", (r) => r.abort());
    await page.setContent(docPage(md, o), { waitUntil: "load" });
    return await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
  } finally {
    await browser.close();
  }
}
