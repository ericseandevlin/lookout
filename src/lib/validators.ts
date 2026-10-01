import { z } from "zod";

export const LinkUrl = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine((u) => !/^(javascript|data|vbscript|file):/i.test(u), "Unsupported link");
