import "server-only";
import { lookup } from "node:dns";
import { isIP } from "node:net";
// undici's own fetch: Node 22's built-in fetch rejects an Agent from a newer undici.
import { Agent, fetch } from "undici";

/**
 * Fetch a public web page safely. Users paste arbitrary links, so this must
 * never reach the VPS's own network: private, loopback, link-local and
 * metadata addresses are refused at connect time (which also defeats DNS
 * rebinding), only ports 80/443 are allowed, and redirects are re-checked.
 */

export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast + reserved
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return false;
  if (v6.startsWith("::ffff:")) return isPublicIp(v6.slice(7));
  if (/^f[cd]/.test(v6)) return false; // unique local
  if (/^fe[89ab]/.test(v6)) return false; // link-local
  if (v6.startsWith("ff")) return false; // multicast
  return true;
}

const agent = new Agent({
  connect: {
    timeout: 8_000,
    lookup(hostname, options, cb) {
      lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, "", 4);
        const list = (Array.isArray(addrs) ? addrs : [addrs]) as { address: string; family: number }[];
        const bad = list.find((a) => !isPublicIp(a.address));
        if (bad || !list.length) return cb(new Error(`Blocked address for ${hostname}`), "", 4);
        // undici calls lookup with all:true and expects the array back
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
        cb(null, list[0].address, list[0].family);
      });
    },
  },
});

const MAX_BYTES = 2_000_000;

export class FetchError extends Error {}

export async function fetchPage(rawUrl: string): Promise<{ url: string; html: string }> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new FetchError("Only http and https links are supported");
    if (url.port && url.port !== "80" && url.port !== "443") throw new FetchError("That port isn't allowed");
    if (url.username || url.password) throw new FetchError("Links with credentials aren't allowed");
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicIp(url.hostname.replace(/^\[|\]$/g, ""))) throw new FetchError("That address isn't allowed");
    const res = await fetch(url, {
      redirect: "manual",
      dispatcher: agent,
      signal: AbortSignal.timeout(15_000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LookoutBot/1.0; +https://findsboard.com)",
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new FetchError("Redirect without a location");
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new FetchError(`The page answered ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|json|text\/plain|xml/i.test(type)) throw new FetchError("That link isn't a web page");
    const reader = res.body?.getReader();
    if (!reader) return { url: url.toString(), html: "" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url: url.toString(), html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new FetchError("Too many redirects");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Readable text plus any schema.org JobPosting data, which most ATS pages embed. */
export function pageToText(html: string, maxChars = 9000) {
  const ld: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/JobPosting/i.test(m[1])) ld.push(m[1].trim().slice(0, 6000));
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (_, e) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1)) || 32) : " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return [title && `TITLE: ${title}`, ld.length && `STRUCTURED DATA:\n${ld.join("\n")}`, `TEXT:\n${text}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, maxChars);
}
