import { adminRoute, HttpError, json } from "@/lib/api";

type OrModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
};

export type CatalogModel = { id: string; name: string; context: number; priceIn: number | null; priceOut: number | null; structured: boolean | null };

const caches = new Map<string, { at: number; models: CatalogModel[] }>();

async function openrouter(): Promise<CatalogModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(502, `OpenRouter answered ${res.status}`);
  const { data } = (await res.json()) as { data: OrModel[] };
  const perM = (v?: string) => (v ? Math.round(Number(v) * 1e6 * 1000) / 1000 : 0);
  return data
    .map((m) => ({
      id: m.id,
      name: m.name,
      context: m.context_length ?? 0,
      priceIn: perM(m.pricing?.prompt),
      priceOut: perM(m.pricing?.completion),
      structured: !!m.supported_parameters?.some((p) => p === "structured_outputs" || p === "response_format"),
    }))
    // Negative prices mark routers/variable-price entries; skip them.
    .filter((m) => m.priceIn >= 0 && m.priceOut >= 0)
    .sort((a, b) => a.priceIn + a.priceOut - (b.priceIn + b.priceOut));
}

/**
 * OpenCode Zen lists IDs only, no prices. Claude, GPT, Gemini, Grok and Jev models there
 * use other API formats, so only the /chat/completions ones are offered.
 */
async function opencode(): Promise<CatalogModel[]> {
  const res = await fetch("https://opencode.ai/zen/v1/models", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(502, `OpenCode answered ${res.status}`);
  const { data } = (await res.json()) as { data: { id: string }[] };
  return data
    .filter((m) => !/^(claude|gpt|gemini|grok|jev)/i.test(m.id))
    .map((m) => ({ id: m.id, name: m.id, context: 0, priceIn: null, priceOut: null, structured: null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A provider's public model list, trimmed for the admin picker. Cached for an hour. */
export const GET = adminRoute(async (req) => {
  const source = new URL(req.url).searchParams.get("source") === "opencode" ? "opencode" : "openrouter";
  const hit = caches.get(source);
  if (hit && Date.now() - hit.at < 3600_000) return json({ models: hit.models });
  const models = source === "opencode" ? await opencode() : await openrouter();
  caches.set(source, { at: Date.now(), models });
  return json({ models });
});
