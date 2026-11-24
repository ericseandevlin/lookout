import { z } from "zod";

export const LinkUrl = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine((u) => !/^(javascript|data|vbscript|file):/i.test(u), "Unsupported link")
  // A web address, not a sentence (#1662): no spaces, http(s) if a scheme is given, and a dot in the host.
  .refine(isWebAddress, "Paste a web address, like yoursite.com");

function isWebAddress(u: string) {
  if (/\s/.test(u)) return false;
  const scheme = u.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1];
  if (scheme && !/^https?$/i.test(scheme)) return false;
  const host = u.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  return /^[^.@]+(\.[^.]+)+$/.test(host);
}
