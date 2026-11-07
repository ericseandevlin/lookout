import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = await mkdtemp(path.join(tmpdir(), "lookout-files-"));
vi.stubEnv("DATA_DIR", dir);
vi.stubEnv("APP_SECRET", "a".repeat(32));

const { deleteUserFile, deleteUserFiles, readUserFile, saveUserFile, sniff } = await import("./files");

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

describe("sniff", () => {
  it("knows a PDF by its magic bytes, whatever the name", () => {
    expect(sniff(Buffer.from("%PDF-1.7\n"), "resume.docx")?.ext).toBe("pdf");
  });

  it("takes a ZIP only when it is named .docx", () => {
    expect(sniff(zip, "Resume.DOCX")?.ext).toBe("docx");
    expect(sniff(zip, "resume.zip")).toBeNull();
  });

  it("refuses anything else, even with a trusted name", () => {
    expect(sniff(Buffer.from("hello"), "resume.pdf")).toBeNull();
    expect(sniff(Buffer.alloc(0), "resume.docx")).toBeNull();
  });
});

describe("user files", () => {
  it("saves under the user's folder and reads back", async () => {
    const key = await saveUserFile("u1", Buffer.from("data"), "pdf");
    expect(key).toMatch(/^u1\/[0-9a-f-]{36}\.pdf$/);
    expect((await readUserFile(key)).toString()).toBe("data");
    const onDisk = path.join(dir, "uploads", key);
    expect((await stat(onDisk)).mode & 0o777).toBe(0o600);
    expect((await readFile(onDisk)).includes("data")).toBe(false);
    await deleteUserFile(key);
    await expect(readUserFile(key)).rejects.toThrow();
  });

  it("refuses keys that leave the uploads folder", async () => {
    await expect(async () => readUserFile("../secret.txt")).rejects.toThrow("Bad file key");
    await expect(async () => readUserFile("u1/../../secret.txt")).rejects.toThrow("Bad file key");
    await expect(async () => readUserFile("/etc/passwd")).rejects.toThrow("Bad file key");
    await expect(async () => deleteUserFile("..")).rejects.toThrow("Bad file key");
  });

  it("deletes everything for a user", async () => {
    const key = await saveUserFile("u2", Buffer.from("data"), "docx");
    await deleteUserFiles("u2");
    await expect(readUserFile(key)).rejects.toThrow();
  });
});
