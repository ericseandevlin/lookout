import { adminRoute, HttpError, json } from "@/lib/api";

type OrModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
};

let cache: { at: number; models: unknown[] } | null = null;

/** OpenRouter's public model list, trimmed for the admin picker. Cached for an hour. */
export const GET = adminRoute(async () => {
  if (cache && Date.now() - cache.at < 3600_000) return json({ models: cache.models });
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(502, `OpenRouter answered ${res.status}`);
  const { data } = (await res.json()) as { data: OrModel[] };
  const perM = (v?: string) => (v ? Math.round(Number(v) * 1e6 * 1000) / 1000 : 0);
  const models = data
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
  cache = { at: Date.now(), models };
  return json({ models });
});
