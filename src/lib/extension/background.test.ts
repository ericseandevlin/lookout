import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * The Firefox extension's background script (#593): extension/firefox/background.js, which spots the
 * thank-you page after Submit and marks the application Submitted in Lookout. Only the extension API
 * and fetch are stubbed.
 */
const SOURCE = readFileSync(path.resolve(__dirname, "../../../extension/firefox/background.js"), "utf8");

type Msg = Record<string, unknown>;
type Nav = { tabId: number; frameId: number; url: string };

function background(opts: { token?: string | null; reply?: { status: number; body?: unknown } | Error; pageText?: string | null } = {}) {
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = opts.token === null ? {} : { cfg: { server: "https://x", token: opts.token ?? "lkx_test" } };
  let onMessage: ((msg: Msg, sender: { tab?: { id: number; url?: string }; url?: string }) => Promise<unknown>) | undefined;
  let onNav: ((d: Nav) => Promise<unknown>) | undefined;
  let onRemoved: ((tabId: number) => Promise<unknown>) | undefined;
  const badge: { tabId: number; text?: string; color?: string }[] = [];
  const reply = opts.reply ?? { status: 200, body: { ok: true } };
  const fetch = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body ?? {} };
  });
  const executeScript = vi.fn(async ({ func, args }: { func: (src: string) => string | null; args: [string] }) => {
    if (opts.pageText === undefined) return [];
    // Run the injected function against a stand-in page body; it reads document from the script's own global.
    sandbox.document = { body: opts.pageText === null ? null : { innerText: opts.pageText } };
    return [{ result: func(...args) }];
  });
  const sandbox: Record<string, unknown> = { fetch, Date, JSON, RegExp, String, URL, Set };
  const browser = {
    storage: {
      session: { get: async (k: string) => ({ [k]: session[k] }), set: async (o: Record<string, unknown>) => Object.assign(session, o) },
      local: { get: async (k: string) => ({ [k]: local[k] }) },
    },
    runtime: { onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) } },
    webNavigation: { onCompleted: { addListener: (fn: typeof onNav) => (onNav = fn) } },
    tabs: { onRemoved: { addListener: (fn: typeof onRemoved) => (onRemoved = fn) } },
    scripting: { executeScript },
    action: {
      setBadgeBackgroundColor: async ({ tabId, color }: { tabId: number; color: string }) => badge.push({ tabId, color }),
      setBadgeText: async ({ tabId, text }: { tabId: number; text: string }) => badge.push({ tabId, text }),
    },
  };
  sandbox.browser = browser;
  vm.runInNewContext(SOURCE, sandbox);
  const watches = () => (session.watches ?? {}) as Record<string, { appId: string; armed: boolean; until: number }>;
  return {
    fetch,
    executeScript,
    badge,
    watches,
    send: (msg: Msg, tabId?: number, at?: { tab: string; frame?: string }) =>
      onMessage!(msg, tabId === undefined ? {} : { tab: { id: tabId, url: at?.tab }, url: at?.frame ?? at?.tab }),
    nav: (d: Nav) => onNav!(d),
    close: (tabId: number) => onRemoved!(tabId),
  };
}

const watch = { type: "lookout-watch", tabId: 7, appId: "app-1", server: "https://x" };

describe("extension background (#593)", () => {
  it("watches a tab after a fill, unarmed, for an hour", async () => {
    const bg = background();
    expect(await bg.send(watch)).toEqual({ ok: true });
    const w = bg.watches()[7];
    expect(w).toMatchObject({ appId: "app-1", armed: false });
    expect(w.until - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it("ignores a thank-you before Submit was pressed", async () => {
    const bg = background();
    await bg.send(watch);
    expect(await bg.send({ type: "lookout-thanks", url: "https://jobs/x", text: "Thank you for applying" }, 7)).toBeUndefined();
    expect(bg.fetch).not.toHaveBeenCalled();
  });

  it("arms on Submit, then marks the application submitted on the thank-you and drops the watch", async () => {
    const bg = background();
    await bg.send(watch);
    expect(await bg.send({ type: "lookout-armed" }, 7)).toEqual({ ok: true });
    expect(bg.watches()[7].armed).toBe(true);
    expect(await bg.send({ type: "lookout-thanks", url: "https://jobs/x/thanks", text: "Thank you for applying" }, 7)).toEqual({ ok: true });
    expect(bg.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = bg.fetch.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("https://x/api/ext/applications/app-1/submitted");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer lkx_test");
    expect(JSON.parse(init.body)).toEqual({ url: "https://jobs/x/thanks", text: "Thank you for applying" });
    expect(bg.watches()[7]).toBeUndefined();
    expect(bg.badge).toEqual([
      { tabId: 7, color: "#2E7D32" },
      { tabId: 7, text: "✓" },
    ]);
    // A second thank-you on the same tab has nothing to mark.
    expect(await bg.send({ type: "lookout-thanks", url: "https://jobs/x/thanks" }, 7)).toBeUndefined();
    expect(bg.fetch).toHaveBeenCalledTimes(1);
  });

  it("caps what it sends: url at 2000 characters, text at 300", async () => {
    const bg = background();
    await bg.send(watch);
    await bg.send({ type: "lookout-armed" }, 7);
    await bg.send({ type: "lookout-thanks", url: "https://j/" + "a".repeat(3000), text: "t".repeat(500) }, 7);
    const body = JSON.parse((bg.fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.url).toHaveLength(2000);
    expect(body.text).toHaveLength(300);
  });

  it("marks by hand from the popup's I submitted it, armed or not", async () => {
    const bg = background();
    await bg.send(watch);
    expect(await bg.send({ type: "lookout-mark", tabId: 7 })).toEqual({ ok: true });
    expect(JSON.parse((bg.fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({});
  });

  it("says what's wrong when there is no watch, no token, or Lookout refuses", async () => {
    expect(await background().send({ type: "lookout-mark", tabId: 7 })).toEqual({ ok: false, error: "Fill an application in this tab first." });

    const noToken = background({ token: null });
    await noToken.send(watch);
    expect(await noToken.send({ type: "lookout-mark", tabId: 7 })).toEqual({ ok: false, error: "Add your extension token in Settings." });
    expect(noToken.fetch).not.toHaveBeenCalled();

    const refused = background({ reply: { status: 409, body: { error: "Already submitted." } } });
    await refused.send(watch);
    expect(await refused.send({ type: "lookout-mark", tabId: 7 })).toEqual({ ok: false, error: "Already submitted." });
    // The watch stays so a retry can still mark it.
    expect(refused.watches()[7]).toBeDefined();
    expect(refused.badge).toEqual([]);

    const bare = background({ reply: { status: 502 } });
    await bare.send(watch);
    expect(await bare.send({ type: "lookout-mark", tabId: 7 })).toEqual({ ok: false, error: "Lookout answered 502" });

    const offline = background({ reply: new Error("NetworkError when attempting to fetch resource.") });
    await offline.send(watch);
    expect(await offline.send({ type: "lookout-mark", tabId: 7 })).toEqual({ ok: false, error: "NetworkError when attempting to fetch resource." });
  });

  it("checks each page an armed tab loads for a thank-you", async () => {
    const bg = background({ pageText: "Great news! We have received your application for Director of Events." });
    await bg.send(watch);
    await bg.nav({ tabId: 7, frameId: 0, url: "https://jobs/x/1" });
    // Not armed yet: the page isn't read.
    expect(bg.executeScript).not.toHaveBeenCalled();
    await bg.send({ type: "lookout-armed" }, 7);
    await bg.nav({ tabId: 7, frameId: 3, url: "https://jobs/x/done" });
    expect(bg.executeScript.mock.calls[0][0]).toMatchObject({ target: { tabId: 7, frameIds: [3] } });
    expect(JSON.parse((bg.fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      url: "https://jobs/x/done",
      text: "We have received your application",
    });
  });

  it("reads a thank-you only on the sites the application was filled on (#1052)", async () => {
    const bg = background({ pageText: "Thank you for applying to Globex!" });
    await bg.send(watch);
    // Submit pressed in a Greenhouse form embedded on the company's own page.
    await bg.send({ type: "lookout-armed" }, 7, { tab: "https://careers.acme.com/jobs?gh_jid=1", frame: "https://boards.greenhouse.io/embed/job_app?for=acme" });
    await bg.nav({ tabId: 7, frameId: 0, url: "https://jobs.lever.co/globex/123/thanks" });
    await bg.nav({ tabId: 7, frameId: 0, url: "https://mail.example.com/inbox" });
    expect(await bg.send({ type: "lookout-thanks", url: "https://globex.com/careers/thanks", text: "Thank you for applying" }, 7)).toBeUndefined();
    expect(bg.fetch).not.toHaveBeenCalled();
    expect(bg.watches()[7].armed).toBe(true);
    // The same ATS on another subdomain counts.
    await bg.nav({ tabId: 7, frameId: 4, url: "https://job-boards.greenhouse.io/acme/jobs/1/confirmation" });
    expect(bg.fetch).toHaveBeenCalledTimes(1);
  });

  it("reads a thank-you on the company's own page after an embedded form (#1052)", async () => {
    const bg = background();
    await bg.send(watch);
    await bg.send({ type: "lookout-armed" }, 7, { tab: "https://careers.acme.co.uk/jobs/1", frame: "https://jobs.ashbyhq.com/acme/embed" });
    expect(await bg.send({ type: "lookout-thanks", url: "https://www.acme.co.uk/thanks", text: "Thank you for applying" }, 7)).toEqual({ ok: true });
  });

  it("leaves an armed tab alone when the page has no thank-you, no body, or can't be read", async () => {
    for (const pageText of ["Please fix the errors below", null, undefined]) {
      const bg = background({ pageText });
      await bg.send(watch);
      await bg.send({ type: "lookout-armed" }, 7);
      await bg.nav({ tabId: 7, frameId: 0, url: "https://jobs/x" });
      expect(bg.fetch).not.toHaveBeenCalled();
      expect(bg.watches()[7].armed).toBe(true);
    }
  });

  it("drops an armed watch once its 15 minutes are up", async () => {
    vi.useFakeTimers();
    try {
      const bg = background({ pageText: "Thank you for applying" });
      await bg.send(watch);
      await bg.send({ type: "lookout-armed" }, 7);
      vi.advanceTimersByTime(16 * 60_000);
      await bg.nav({ tabId: 7, frameId: 0, url: "https://jobs/x/thanks" });
      expect(bg.watches()[7]).toBeUndefined();
      expect(bg.executeScript).not.toHaveBeenCalled();
      expect(bg.fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets a tab's watch when the tab closes, and ignores other tabs", async () => {
    const bg = background();
    await bg.send(watch);
    await bg.send({ ...watch, tabId: 8, appId: "app-2" });
    await bg.close(7);
    expect(Object.keys(bg.watches())).toEqual(["8"]);
    await bg.close(99);
    expect(Object.keys(bg.watches())).toEqual(["8"]);
  });
});
