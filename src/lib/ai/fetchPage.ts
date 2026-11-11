import "server-only";
import { lookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
// undici's own fetch: Node 22's built-in fetch rejects an Agent from a newer undici.
import { Agent, fetch } from "undici";
import { findPay, payLine } from "./pay";

/**
 * Fetch a public web page safely. Users paste arbitrary links, so this must
 * never reach the VPS's own network: private, loopback, link-local and
 * metadata addresses are refused at connect time (which also defeats DNS
 * rebinding), only ports 80/443 are allowed, and redirects are re-checked.
 */

function publicV4(ip: string): boolean {
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

/** An IPv6 address as its eight 16-bit groups, with a trailing dotted IPv4 part folded in. */
function groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (isIP(v4[1]) !== 4) return null;
    const [a, b, c, d] = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0) return null;
  const all = [...h, ...Array(fill).fill("0"), ...t].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every((n) => n >= 0 && n <= 0xffff) ? all : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) return publicV4(ip);
  if (isIP(ip) !== 6) return false;
  const g = groups(ip);
  if (!g) return false;
  // IPv4 inside IPv6 is checked as the IPv4 address it reaches (#207). The URL parser writes
  // [::ffff:127.0.0.1] as [::ffff:7f00:1], so the hex form has to count too.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return g[5] === 0 && g[6] === 0 && g[7] <= 1 ? false : publicV4(v4From(g[6], g[7])); // mapped, compatible, ::, ::1
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && g.slice(3, 6).every((x) => x === 0) && publicV4(v4From(g[6], g[7])); // NAT64; 64:ff9b:1::/48 is local
  if (g[0] === 0x2002) return publicV4(v4From(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return false; // Teredo, documentation
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if (g[0] >> 8 === 0xff) return false; // multicast
  return true;
}

/** DNS lookup for the connect step: fails if any address the host resolves to isn't public. Exported for tests (#403). */
export const safeLookup: LookupFunction = (hostname, options, cb) => {
  lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = (Array.isArray(addrs) ? addrs : [addrs]) as { address: string; family: number }[];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (bad || !list.length) return cb(new Error(`Blocked address for ${hostname}`), "", 4);
    // undici calls lookup with all:true and expects the array back
    if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

const agent = new Agent({ connect: { timeout: 8_000, lookup: safeLookup } });

const MAX_BYTES = 2_000_000;

export class FetchError extends Error {}

/**
 * Workday posting pages are JavaScript shells with no posting text (#724). The same posting is public JSON at
 * /wday/cxs/{tenant}/{site}/job/{rest}. Returns that address, or null when the link isn't a Workday posting.
 */
export function workdayApi(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const tenant = u.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i)?.[1];
  if (!tenant || u.protocol !== "https:") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (/^[a-z]{2}-[a-z]{2}$/i.test(parts[0] ?? "")) parts.shift(); // optional locale, e.g. en-US
  const [site, job, ...rest] = parts;
  if (!site || job !== "job" || !rest.length) return null;
  return `https://${u.hostname}/wday/cxs/${tenant}/${site}/job/${rest.join("/")}`;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The Workday posting JSON as a small HTML page, so every reader of fetchPage gets the posting text. Null if it isn't one. */
export function workdayToHtml(json: string): string | null {
  try {
    const d = JSON.parse(json) as { jobPostingInfo?: Record<string, unknown> };
    const j = d.jobPostingInfo;
    if (!j || typeof j.title !== "string" || typeof j.jobDescription !== "string") return null;
    // hiringOrganization is the legal employer ("LE0001 Relativity ODA LLC"), not the name people know, so it stays out.
    const facts = [
      ["Location", [j.location, ...(Array.isArray(j.additionalLocations) ? j.additionalLocations : [])].filter(Boolean).join("; ")],
      ["Time type", j.timeType],
      ["Posted", j.postedOn],
      ["Start date", j.startDate],
      ["Job ID", j.jobReqId],
      // Workday keeps a filled posting's data; canApply false is the sign it closed.
      j.canApply === false || j.posted === false ? ["Status", "This job is no longer accepting applications."] : null,
    ].filter((f): f is [string, string] => !!f && !!f[1]);
    return `<title>${esc(j.title)}</title>\n${facts.map(([k, v]) => `<p>${k}: ${esc(v)}</p>`).join("\n")}\n${j.jobDescription}`;
  } catch {
    return null;
  }
}

export async function fetchPage(rawUrl: string): Promise<{ url: string; html: string }> {
  const api = workdayApi(rawUrl);
  if (api) {
    try {
      const html = workdayToHtml((await fetchRaw(api)).html);
      if (html) return { url: rawUrl, html };
    } catch (e) {
      // A posting Workday has removed answers 404 here, while the page itself still answers 200 with an empty shell.
      if (e instanceof FetchError && /answered (404|410)/.test(e.message)) throw e;
    }
  }
  return fetchRaw(rawUrl);
}

async function fetchRaw(rawUrl: string): Promise<{ url: string; html: string }> {
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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£",
};

/** Named, decimal and hex (&#x27;, which React writes for every apostrophe) entities; unknown or invalid ones become a space (#491). */
function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) => {
    if (!e.startsWith("#")) return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? " ";
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
  });
}

/** Readable text plus any schema.org JobPosting data, which most ATS pages embed. */
export function pageToText(html: string, maxChars = 9000) {
  const ld: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/JobPosting/i.test(m[1])) ld.push(m[1].trim().slice(0, 6000));
  }
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  // Pay goes right under the title: ATS pages often list it last, where the length cap would cut it off.
  const pay = findPay(html, text);
  return [title && `TITLE: ${title}`, pay && payLine(pay), ld.length && `STRUCTURED DATA:\n${ld.join("\n")}`, `TEXT:\n${text}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, maxChars);
}
