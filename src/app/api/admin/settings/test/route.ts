import { z } from "zod";
import { adminRoute, body, json } from "@/lib/api";
import { AiConfigSchema, getAiConfig, getSearchConfig, SearchConfigSchema } from "@/lib/config";
import { configFor, testModel } from "@/lib/ai/llm";
import { testSearch } from "@/lib/ai/search";
import { fetchPage, pageToText } from "@/lib/ai/fetchPage";

const Input = z.discriminatedUnion("section", [
  /** writing: test the writing model (#1532), with the main model's key and endpoint. */
  z.object({ section: z.literal("ai"), values: AiConfigSchema, writing: z.boolean().optional() }),
  z.object({ section: z.literal("search"), values: SearchConfigSchema }),
  z.object({ section: z.literal("fetch"), url: z.string().url() }),
]);

/** Try the settings on the form before saving. Blank secrets fall back to the stored ones. */
export const POST = adminRoute(async (req) => {
  const p = await body(req, Input);
  try {
    if (p.section === "ai") {
      const stored = await getAiConfig();
      const values = { ...p.values, apiKey: p.values.apiKey || stored.apiKey };
      if (p.writing && !values.writing?.model.trim()) return json({ ok: false, error: "No writing model is set." });
      return json(await testModel(p.writing ? configFor(values, "apply-letter") : values));
    }
    if (p.section === "search") {
      const stored = await getSearchConfig();
      return json(await testSearch({ ...p.values, braveKey: p.values.braveKey || stored.braveKey }));
    }
    const started = Date.now();
    const { url, html } = await fetchPage(p.url);
    return json({ ok: true, url, chars: pageToText(html).length, ms: Date.now() - started });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Failed" });
  }
});
