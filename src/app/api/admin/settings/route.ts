import { z } from "zod";
import { adminRoute, body, json } from "@/lib/api";
import { AccessConfigSchema, AiConfigSchema, publicConfig, saveConfig, SearchConfigSchema } from "@/lib/config";

export const GET = adminRoute(async () => json(await publicConfig()));

const Input = z.object({
  ai: AiConfigSchema.optional(),
  search: SearchConfigSchema.optional(),
  access: AccessConfigSchema.optional(),
});

export const PUT = adminRoute(async (req) => {
  const p = await body(req, Input);
  if (p.ai) await saveConfig("ai", p.ai);
  if (p.search) await saveConfig("search", p.search);
  if (p.access) await saveConfig("access", p.access);
  return json(await publicConfig());
});
