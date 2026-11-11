/** HTML entity decoding shared by the page reader and the pay reader (#742). */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£",
};

/** Named, decimal and hex (&#x27;, which React writes for every apostrophe) entities; unknown or invalid ones become a space (#491). */
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) => {
    if (!e.startsWith("#")) return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? " ";
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
  });
}
