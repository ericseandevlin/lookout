import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { bodyText, listInbound, storeReceived, triageInbound, verifyWebhook } = await import("./index");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});

const secret = "whsec_" + Buffer.from("test-secret-key-32-bytes-long!!!").toString("base64");
const sign = (id: string, ts: string, body: string) =>
  "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

describe("verifyWebhook (#178)", () => {
  const body = '{"type":"email.received"}';
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  it("accepts Resend's signature, including one of several", () => {
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, now)).toBe(true);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sign("msg_1", ts, body)}` }, body, now)).toBe(true);
  });
  it("rejects a changed body, an old timestamp, missing headers and a bad secret", () => {
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body + " ", now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, now + 10 * 60_000)).toBe(false);
    expect(verifyWebhook(secret, { id: null, timestamp: ts, signature: sign("msg_1", ts, body) }, body, now)).toBe(false);
    expect(verifyWebhook("", { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, now)).toBe(false);
  });
});

describe("bodyText", () => {
  it("prefers the text part and falls back to HTML without tags or scripts", () => {
    expect(bodyText("Hi there", "<p>ignored</p>")).toBe("Hi there");
    expect(bodyText("", "<style>x{}</style><p>Thanks for applying</p><p>Talk soon &amp; best</p>")).toBe("Thanks for applying\nTalk soon & best");
  });
  it("decodes each entity once, numeric ones too, and drops comments (#497)", () => {
    expect(bodyText("", "<p>Use &amp;lt;b&amp;gt; for bold</p>")).toBe("Use &lt;b&gt; for bold");
    expect(bodyText("", "<p>Don&#39;t miss &quot;Design Lead&quot; &#x2014; it&#x27;s new</p>")).toBe("Don't miss \"Design Lead\" — it's new");
    expect(bodyText("", "<!--[if mso]><p>a > b</p><![endif]--><p>Hello&nbsp;Eric</p>")).toBe("Hello Eric");
    expect(bodyText("", "<head><title>Ignore me</title></head><body>Hi</body>")).toBe("Hi");
    expect(bodyText("", "<p>R&D &unknown; &#0; stays</p>")).toBe("R&D &unknown; &#0; stays");
  });
});

describe("store and triage", () => {
  const fake = async (id: string) => ({
    id,
    from: "recruiter@redventures.com",
    to: ["eric@lookout.ericdevlin.co"],
    subject: "Your application",
    text: "Can you talk Tuesday?",
    created_at: "2026-10-31T16:00:00Z",
    headers: { From: "Jo Recruiter <recruiter@redventures.com>", "In-Reply-To": "<abc@lookout>" },
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  });
  it("stores a message once, then the agent's triage", async () => {
    expect(await storeReceived("em_1", fake)).toBe(true);
    expect(await storeReceived("em_1", fake)).toBe(false);
    const [m] = await listInbound("new", 10);
    expect(m).toMatchObject({ fromAddr: "recruiter@redventures.com", fromHeader: "Jo Recruiter <recruiter@redventures.com>", inReplyTo: "<abc@lookout>", text: "Can you talk Tuesday?" });
    expect(await triageInbound(m.id, "triaged", { kind: "recruiter", summary: "Wants a call Tuesday.", by: "test" })).toBe(true);
    expect(await listInbound("new", 10)).toHaveLength(0);
    expect((await listInbound("triaged", 10))[0].triage?.summary).toBe("Wants a call Tuesday.");
  });
});
