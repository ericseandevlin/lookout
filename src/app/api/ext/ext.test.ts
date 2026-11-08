import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://lookout.test" }),
}));
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => me,
  refreshSession: async () => {},
}));
// Building the packet renders Word files; the routes only decide who gets it and in what shape.
const preparePacket = vi.fn();
vi.mock("@/lib/application/submit", () => ({ preparePacket }));

const token = await import("./token/route");
const { GET: match } = await import("./match/route");
const { GET: packet } = await import("./applications/[id]/packet/route");
const { POST: submitted } = await import("./applications/[id]/submitted/route");
const { createExtensionToken } = await import("@/lib/extension");

const dir = await mkdtemp(path.join(tmpdir(), "lookout-ext-"));
const URL_ = "https://lookout.test/api/ext";
const tokenCall = (method: "GET" | "POST" | "DELETE") =>
  token[method](new Request(`${URL_}/token`, { method }), {});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const matchCall = (t: string, ...urls: string[]) =>
  match(
    new Request(
      `${URL_}/match?${urls.map((u) => `url=${encodeURIComponent(u)}`).join("&")}`,
      { headers: bearer(t) },
    ),
    {},
  );
const packetCall = (t: string, id: string) =>
  packet(
    new Request(`${URL_}/applications/${id}/packet`, { headers: bearer(t) }),
    { params: Promise.resolve({ id }) },
  );
const submittedCall = (t: string, id: string, data: unknown = {}) =>
  submitted(
    new Request(`${URL_}/applications/${id}/submitted`, {
      method: "POST",
      headers: { ...bearer(t), "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
    {
      params: Promise.resolve({ id }),
    },
  );

const user = async (email: string, isAdmin = true) =>
  (await db.insert(schema.users).values({ email, isAdmin }).returning())[0];
async function application(
  u: User,
  status: typeof schema.applications.$inferSelect.status,
  sourceUrl: string,
  applyUrl?: string,
) {
  const [s] = await db
    .insert(schema.searches)
    .values({ userId: u.id, name: "S", kind: "job" })
    .returning();
  const [o] = await db
    .insert(schema.opportunities)
    .values({
      type: "job",
      company: "Acme",
      title: "Designer",
      sourceUrl,
      fingerprint: crypto.randomUUID(),
    })
    .returning();
  await db
    .insert(schema.userOpportunities)
    .values({
      userId: u.id,
      searchId: s.id,
      opportunityId: o.id,
      score: 80,
      stage: "Interested",
    });
  const [a] = await db
    .insert(schema.applications)
    .values({
      userId: u.id,
      opportunityId: o.id,
      status,
      report: applyUrl ? { applyUrl } : {},
    })
    .returning();
  return { a, o };
}
const stage = async (opportunityId: string) =>
  (
    await db
      .select()
      .from(schema.userOpportunities)
      .where(eq(schema.userOpportunities.opportunityId, opportunityId))
  )[0].stage;
const appRow = async (id: string) =>
  (
    await db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, id))
  )[0];

let alice: User, bob: User, aliceToken: string, bobToken: string;

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../../drizzle"),
  });
});
afterAll(async () => {
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  preparePacket.mockReset();
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  aliceToken = await createExtensionToken(alice.id);
  bobToken = await createExtensionToken(bob.id);
  me = alice;
});

describe("/api/ext/token (#469)", () => {
  it("is 404 for everyone without auto-apply", async () => {
    process.env.FEATURE_AUTO_APPLY = "off";
    for (const m of ["GET", "POST", "DELETE"] as const)
      expect((await tokenCall(m)).status).toBe(404);
    process.env.FEATURE_AUTO_APPLY = "on";
    me = await user("carol@example.com", false);
    for (const m of ["GET", "POST", "DELETE"] as const)
      expect((await tokenCall(m)).status).toBe(404);
  });

  it("needs a session", async () => {
    me = null;
    expect((await tokenCall("GET")).status).toBe(401);
  });

  it("makes a new token that replaces the old one", async () => {
    const res = await tokenCall("POST");
    const { token: fresh } = await res.json();
    expect(fresh).toMatch(/^lkx_/);
    expect((await matchCall(aliceToken, "https://x.test")).status).toBe(401);
    expect((await matchCall(fresh, "https://x.test")).status).toBe(200);
    expect(await (await tokenCall("GET")).json()).toMatchObject({
      connected: true,
    });
  });

  it("revokes only your own token", async () => {
    expect(await (await tokenCall("DELETE")).json()).toEqual({ ok: true });
    expect(await (await tokenCall("GET")).json()).toEqual({ connected: false });
    expect((await matchCall(aliceToken, "https://x.test")).status).toBe(401);
    expect((await matchCall(bobToken, "https://x.test")).status).toBe(200);
  });
});

describe("GET /api/ext/match (#469)", () => {
  it("needs a token", async () => {
    expect(
      (await match(new Request(`${URL_}/match?url=https://x.test`), {})).status,
    ).toBe(401);
  });

  it("finds your ready application from any of the page's URLs", async () => {
    const { a } = await application(
      alice,
      "approved",
      "https://boards.greenhouse.io/acme/jobs/8008090",
    );
    const res = await matchCall(
      aliceToken,
      "https://acme.com/careers",
      "https://job-boards.greenhouse.io/embed/job_app?token=8008090",
    );
    expect(await res.json()).toEqual({
      matches: [
        { id: a.id, status: "approved", company: "Acme", title: "Designer" },
      ],
    });
  });

  it("matches the apply URL as well as the posting", async () => {
    const { a } = await application(
      alice,
      "manual",
      "https://acme.com/jobs/1",
      "https://jobs.lever.co/acme/0b9c2f0e-1111-4222-8333-444455556666/apply",
    );
    const { matches } = await (
      await matchCall(
        aliceToken,
        "https://jobs.lever.co/acme/0b9c2f0e-1111-4222-8333-444455556666",
      )
    ).json();
    expect(matches.map((m: { id: string }) => m.id)).toEqual([a.id]);
  });

  it("leaves out applications not ready to fill and other people's", async () => {
    const job = "https://boards.greenhouse.io/acme/jobs/1";
    for (const s of [
      "queued",
      "drafting",
      "needs_review",
      "canceled",
      "failed",
    ] as const)
      await application(alice, s, job);
    await application(bob, "approved", job);
    expect(await (await matchCall(aliceToken, job)).json()).toEqual({
      matches: [],
    });
  });
});

describe("GET /api/ext/applications/[id]/packet (#469)", () => {
  it("is 404 for someone else's application or a bad id, without building anything", async () => {
    const { a } = await application(bob, "approved", "https://acme.com/jobs/1");
    expect((await packetCall(aliceToken, a.id)).status).toBe(404);
    expect((await packetCall(aliceToken, "not-a-uuid")).status).toBe(404);
    expect(preparePacket).not.toHaveBeenCalled();
  });

  it("is 409 until it is approved, and after it is sent", async () => {
    for (const s of ["needs_review", "submitted"] as const) {
      const { a } = await application(alice, s, "https://acme.com/jobs/1");
      const res = await packetCall(aliceToken, a.id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(
        s === "submitted"
          ? "Already submitted."
          : "Approve every required item first.",
      );
    }
    expect(preparePacket).not.toHaveBeenCalled();
  });

  it("returns the steps in order with each file inline and named by its base name", async () => {
    const { a, o } = await application(
      alice,
      "approved",
      "https://acme.com/jobs/1",
    );
    const file = path.join(dir, "Alice Resume.docx");
    await writeFile(file, "word bytes");
    preparePacket.mockResolvedValue({
      opp: o,
      steps: [
        {
          prompt: "Resume",
          required: true,
          itemKind: "resume",
          kind: "file",
          file,
        },
        {
          prompt: "Why us?",
          required: true,
          itemKind: "question",
          kind: "text",
          content: "Because.",
        },
      ],
    });
    const res = await packetCall(aliceToken, a.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: a.id,
      company: "Acme",
      title: "Designer",
      phoneCountry: "United States",
      steps: [
        {
          prompt: "Resume",
          required: true,
          itemKind: "resume",
          kind: "file",
          file: {
            name: "Alice Resume.docx",
            base64: Buffer.from("word bytes").toString("base64"),
          },
        },
        {
          prompt: "Why us?",
          required: true,
          itemKind: "question",
          kind: "text",
          content: "Because.",
        },
      ],
    });
  });
});

describe("POST /api/ext/applications/[id]/submitted (#469)", () => {
  it("records the submission and moves the find to Applied", async () => {
    const { a, o } = await application(
      alice,
      "approved",
      "https://acme.com/jobs/1",
      "https://acme.com/jobs/1/apply",
    );
    const res = await submittedCall(aliceToken, a.id, {
      url: "https://acme.com/thanks",
      text: "Thanks for applying",
    });
    expect(await res.json()).toEqual({ status: "submitted" });
    const row = await appRow(a.id);
    expect(row.status).toBe("submitted");
    expect(row.confirmation).toMatchObject({
      how: "extension",
      url: "https://acme.com/thanks",
      text: "Thanks for applying",
      applyUrl: "https://acme.com/jobs/1/apply",
    });
    expect(await stage(o.id)).toBe("Applied");
  });

  it("records it once", async () => {
    const { a } = await application(alice, "manual", "https://acme.com/jobs/1");
    await submittedCall(aliceToken, a.id, { text: "first" });
    expect(
      await (await submittedCall(aliceToken, a.id, { text: "second" })).json(),
    ).toEqual({ status: "submitted" });
    expect((await appRow(a.id)).confirmation).toMatchObject({ text: "first" });
  });

  it("is 409 before approval and 404 for someone else's, changing nothing", async () => {
    const mine = await application(
      alice,
      "needs_review",
      "https://acme.com/jobs/1",
    );
    const theirs = await application(
      bob,
      "approved",
      "https://acme.com/jobs/2",
    );
    expect((await submittedCall(aliceToken, mine.a.id)).status).toBe(409);
    expect((await submittedCall(aliceToken, theirs.a.id)).status).toBe(404);
    expect((await appRow(mine.a.id)).status).toBe("needs_review");
    expect((await appRow(theirs.a.id)).status).toBe("approved");
    expect(await stage(theirs.o.id)).toBe("Interested");
  });

  it("keeps only a web page URL and still records the submission", async () => {
    for (const url of [
      "not a url",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
    ]) {
      const { a } = await application(
        alice,
        "approved",
        "https://acme.com/jobs/1",
      );
      expect(
        await (await submittedCall(aliceToken, a.id, { url })).json(),
      ).toEqual({ status: "submitted" });
      expect((await appRow(a.id)).confirmation).not.toHaveProperty("url");
    }
  });
});
