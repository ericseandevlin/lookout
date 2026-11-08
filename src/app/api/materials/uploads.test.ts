import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtempSync } from "node:fs";
import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
const dir = mkdtempSync(path.join(tmpdir(), "lookout-uploads-"));
vi.stubEnv("APP_URL", "https://lookout.test");
vi.stubEnv("DATA_DIR", dir);
vi.stubEnv("APP_SECRET", "a".repeat(32));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));
const scanResume = vi.fn(async () => {});
const extractResumeText = vi.fn(async () => "Work history. ".repeat(20));
vi.mock("@/lib/agent/resume", () => ({ scanResume, extractResumeText }));

const resume = await import("./resume/route");
const linkedin = await import("./linkedin/pdf/route");

const PDF = Buffer.from("%PDF-1.7\nfake");
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

const upload = (url: string, file?: { buf: Buffer; name: string }) => {
  const form = new FormData();
  if (file) form.set("file", new File([new Uint8Array(file.buf)], file.name));
  return new Request(`https://lookout.test${url}`, { method: "POST", body: form });
};
const call = (fn: (req: Request, ctx: object) => Promise<Response>, url: string, method = "GET") =>
  fn(new Request(`https://lookout.test${url}`, { method }), {});
const rowsOf = (kind: "resume" | "linkedin") =>
  db.select().from(schema.materials).where(eq(schema.materials.kind, kind));
const onDisk = (key: string) => access(path.join(dir, "uploads", key)).then(() => true, () => false);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.delete(schema.users);
  await db.delete(schema.rateLimits);
  [me] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  scanResume.mockClear();
  extractResumeText.mockClear();
});

describe("/api/materials/resume (#434)", () => {
  it("refuses a missing, oversized or wrong-type file", async () => {
    expect((await resume.POST(upload("/api/materials/resume"), {})).status).toBe(400);
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await resume.POST(upload("/api/materials/resume", { buf: big, name: "cv.pdf" }), {})).status).toBe(413);
    // The name says PDF, the bytes don't.
    expect((await resume.POST(upload("/api/materials/resume", { buf: Buffer.from("hello"), name: "cv.pdf" }), {})).status).toBe(415);
    expect(await rowsOf("resume")).toEqual([]);
  });

  it("stops at 10 uploads a day", async () => {
    await db.insert(schema.rateLimits).values({ key: `resume:${me!.id}`, count: 10, expiresAt: new Date(Date.now() + 3600_000) });
    const res = await resume.POST(upload("/api/materials/resume", { buf: PDF, name: "cv.pdf" }), {});
    expect(res.status).toBe(429);
    expect(await rowsOf("resume")).toEqual([]);
  });

  it("stores a cleaned name, starts the scan, and replaces the old resume", async () => {
    const first = await resume.POST(upload("/api/materials/resume", { buf: PDF, name: 'my "cv"<1>.pdf' }), {});
    expect(first.status).toBe(200);
    expect((await first.json()).resume).toMatchObject({ name: "my _cv__1_.pdf", status: "scanning" });
    const [old] = await rowsOf("resume");
    expect(old).toMatchObject({ mime: "application/pdf", status: "scanning" });
    expect(scanResume).toHaveBeenCalledWith(me!.id, old.id);
    expect(await onDisk(old.fileKey!)).toBe(true);

    expect((await resume.POST(upload("/api/materials/resume", { buf: DOCX, name: "cv.docx" }), {})).status).toBe(200);
    const rows = await rowsOf("resume");
    expect(rows).toHaveLength(1);
    expect(rows[0].fileName).toBe("cv.docx");
    expect(await onDisk(old.fileKey!)).toBe(false);
  });

  it("serves the file with locked-down headers: PDF inline, DOCX as a download", async () => {
    expect((await call(resume.GET, "/api/materials/resume")).status).toBe(404);

    await resume.POST(upload("/api/materials/resume", { buf: PDF, name: "cv.pdf" }), {});
    const pdf = await call(resume.GET, "/api/materials/resume");
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).equals(PDF)).toBe(true);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="cv.pdf"');
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdf.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");

    await resume.POST(upload("/api/materials/resume", { buf: DOCX, name: "cv.docx" }), {});
    const docx = await call(resume.GET, "/api/materials/resume");
    expect(docx.headers.get("content-disposition")).toBe('attachment; filename="cv.docx"');
  });

  it("delete removes the row and the file", async () => {
    await resume.POST(upload("/api/materials/resume", { buf: PDF, name: "cv.pdf" }), {});
    const [row] = await rowsOf("resume");
    expect((await call(resume.DELETE, "/api/materials/resume", "DELETE")).status).toBe(200);
    expect(await rowsOf("resume")).toEqual([]);
    expect(await onDisk(row.fileKey!)).toBe(false);
  });

  it("needs a session", async () => {
    me = null;
    expect((await resume.POST(upload("/api/materials/resume", { buf: PDF, name: "cv.pdf" }), {})).status).toBe(401);
    expect((await call(resume.GET, "/api/materials/resume")).status).toBe(401);
  });
});

describe("/api/materials/linkedin/pdf (#434)", () => {
  const url = "/api/materials/linkedin/pdf";

  it("takes only a PDF with readable text", async () => {
    expect((await linkedin.POST(upload(url, { buf: DOCX, name: "profile.docx" }), {})).status).toBe(415);
    extractResumeText.mockResolvedValueOnce("too short");
    expect((await linkedin.POST(upload(url, { buf: PDF, name: "profile.pdf" }), {})).status).toBe(422);
    extractResumeText.mockRejectedValueOnce(new Error("bad pdf"));
    expect((await linkedin.POST(upload(url, { buf: PDF, name: "profile.pdf" }), {})).status).toBe(422);
    expect(await rowsOf("linkedin")).toEqual([]);
  });

  it("stops at 10 uploads a day", async () => {
    await db.insert(schema.rateLimits).values({ key: `linkedin-pdf:${me!.id}`, count: 10, expiresAt: new Date(Date.now() + 3600_000) });
    expect((await linkedin.POST(upload(url, { buf: PDF, name: "profile.pdf" }), {})).status).toBe(429);
  });

  it("keeps the text and replaces an earlier PDF in place", async () => {
    const res = await linkedin.POST(upload(url, { buf: PDF, name: "Profile (1).pdf" }), {});
    expect(res.status).toBe(200);
    expect((await res.json()).pdf.name).toBe("Profile (1).pdf");
    const [first] = await rowsOf("linkedin");
    expect((first.extracted as { text: string }).text).toContain("Work history.");

    extractResumeText.mockResolvedValueOnce("Newer history. ".repeat(20));
    await linkedin.POST(upload(url, { buf: PDF, name: "Profile.pdf" }), {});
    const rows = await rowsOf("linkedin");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect((rows[0].extracted as { text: string }).text).toContain("Newer history.");
    expect(await onDisk(first.fileKey!)).toBe(false);
    expect(await onDisk(rows[0].fileKey!)).toBe(true);
  });

  it("serves the PDF inline with locked-down headers", async () => {
    expect((await call(linkedin.GET, url)).status).toBe(404);
    await linkedin.POST(upload(url, { buf: PDF, name: "profile.pdf" }), {});
    const res = await call(linkedin.GET, url);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="profile.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  });

  it("delete keeps a saved profile URL but drops the file", async () => {
    await db.insert(schema.materials).values({ userId: me!.id, kind: "linkedin", url: "https://www.linkedin.com/in/someone" });
    await linkedin.POST(upload(url, { buf: PDF, name: "profile.pdf" }), {});
    const [withFile] = await rowsOf("linkedin");
    expect((await call(linkedin.DELETE, url, "DELETE")).status).toBe(200);
    const [row] = await rowsOf("linkedin");
    expect(row).toMatchObject({ url: "https://www.linkedin.com/in/someone", fileKey: null, fileName: null, mime: null, extracted: null });
    expect(await onDisk(withFile.fileKey!)).toBe(false);
  });

  it("delete removes a file-only row", async () => {
    await linkedin.POST(upload(url, { buf: PDF, name: "profile.pdf" }), {});
    await call(linkedin.DELETE, url, "DELETE");
    expect(await rowsOf("linkedin")).toEqual([]);
  });
});
