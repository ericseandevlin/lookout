import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

/**
 * The Firefox extension's popup (#593): extension/firefox/popup.js run on its own popup.html in jsdom.
 * It finds this tab's application in Lookout, picks the frame that holds the form, fills it and reports
 * what filled. Only the extension API and fetch are stubbed.
 */
const DIR = path.resolve(__dirname, "../../../extension/firefox");
const SOURCE = readFileSync(path.join(DIR, "popup.js"), "utf8");
const BODY = readFileSync(path.join(DIR, "popup.html"), "utf8").match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[^>]*><\/script>/, "");

type Match = { id: string; company: string; title: string; status: string };
type LogRow = { prompt: string; ok: boolean; how: string };
type Frame = { frameId: number; url: string };
type Opts = {
  cfg?: { server: string; token: string } | null;
  matches?: Match[];
  routes?: Record<string, { status: number; body?: unknown }>;
  frames?: Frame[];
  probe?: Record<number, number | null>;
  log?: LogRow[];
  granted?: boolean;
  mark?: unknown;
};

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

async function popup(opts: Opts = {}) {
  const dom = new JSDOM(`<!doctype html><body>${BODY}</body>`, { runScripts: "outside-only" });
  const w = dom.window;
  const doc = w.document;
  const stored: Record<string, unknown> = opts.cfg === null ? {} : { cfg: opts.cfg ?? { server: "https://lookout.test", token: "lkx_test" } };
  const frames = opts.frames ?? [{ frameId: 0, url: "https://jobs.example/apply/1" }];
  const routes: Record<string, { status: number; body?: unknown }> = {
    match: { status: 200, body: { matches: opts.matches ?? [] } },
    packet: { status: 200, body: { steps: [{ prompt: "First name", kind: "text", content: "Maya" }] } },
    ...opts.routes,
  };
  const fetch = vi.fn(async (url: string) => {
    const r = url.includes("/api/ext/match") ? routes.match : url.endsWith("/packet") ? routes.packet : { status: 404 };
    return { ok: r.status < 400, status: r.status, json: async () => r.body ?? {} };
  });
  const tabMessages: { msg: { type: string }; frameId: number }[] = [];
  const runtimeMessages: unknown[] = [];
  const browser = {
    storage: { local: { get: async (k: string) => ({ [k]: stored[k] }), set: vi.fn(async (o: Record<string, unknown>) => Object.assign(stored, o)) } },
    tabs: {
      query: async () => [{ id: 7, url: frames[0]?.url ?? "about:blank" }],
      sendMessage: async (_tab: number, msg: { type: string }, { frameId }: { frameId: number }) => {
        tabMessages.push({ msg, frameId });
        if (msg.type === "lookout-probe") {
          const s = opts.probe?.[frameId];
          if (s === null) throw new Error("No listener in this frame");
          return { score: s ?? 0 };
        }
        return { log: opts.log ?? [{ prompt: "First name", ok: true, how: "typed" }] };
      },
    },
    webNavigation: { getAllFrames: async () => frames },
    permissions: { request: async () => opts.granted ?? true },
    scripting: { executeScript: vi.fn(async () => []) },
    runtime: {
      sendMessage: async (m: { type: string }) => {
        runtimeMessages.push(m);
        return m.type === "lookout-mark" ? ("mark" in opts ? opts.mark : { ok: true }) : { ok: true };
      },
    },
  };
  Object.assign(w, { browser, fetch });
  w.eval(SOURCE);
  await flush();
  const $ = (id: string) => doc.getElementById(id) as HTMLElement;
  return {
    $,
    fetch,
    browser,
    stored,
    tabMessages,
    runtimeMessages,
    status: () => ($("status").hidden ? "" : $("status").textContent),
    rows: () => [...doc.querySelectorAll("#matches li")].map((li) => li.textContent),
    button: () => doc.querySelector("#matches button") as HTMLButtonElement,
    log: () => [...doc.querySelectorAll("#log li")].map((li) => ({ text: li.textContent, bad: li.className === "bad" })),
    click: async (el: HTMLElement) => {
      el.click();
      await flush();
    },
  };
}

const job: Match = { id: "app-1", company: "Venue Co", title: "Director of Events", status: "approved" };

describe("extension popup (#593)", () => {
  it("opens Settings and asks for a token when there isn't one", async () => {
    const p = await popup({ cfg: null });
    expect(p.status()).toBe("Add your extension token first.");
    expect(p.$("settings").hidden).toBe(false);
    expect(p.$("gear").getAttribute("aria-expanded")).toBe("true");
    expect(p.fetch).not.toHaveBeenCalled();
  });

  it("looks up every http frame of the tab once, with the token", async () => {
    const p = await popup({
      frames: [
        { frameId: 0, url: "https://careers.example/job/1" },
        { frameId: 4, url: "https://boards.greenhouse.io/x/jobs/1" },
        { frameId: 5, url: "about:blank" },
        { frameId: 6, url: "https://careers.example/job/1" },
      ],
    });
    const [url, init] = p.fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(
      `https://lookout.test/api/ext/match?url=${encodeURIComponent("https://careers.example/job/1")}&url=${encodeURIComponent("https://boards.greenhouse.io/x/jobs/1")}`,
    );
    expect(init.headers.authorization).toBe("Bearer lkx_test");
  });

  it("says so when Lookout has no approved application for the page", async () => {
    const p = await popup();
    expect(p.status()).toMatch(/^No approved Lookout application for this page/);
    expect(p.rows()).toEqual([]);
  });

  it("shows Lookout's error when the lookup fails", async () => {
    const p = await popup({ routes: { match: { status: 401, body: { error: "That extension token was revoked." } } } });
    expect(p.status()).toBe("That extension token was revoked.");
  });

  it("lists matches, with no Fill button on one already submitted", async () => {
    const p = await popup({ matches: [job, { ...job, id: "app-2", company: "Hall Inc", status: "submitted" }] });
    expect(p.status()).toBe("");
    expect(p.rows()).toEqual(["Venue Co: Director of EventsFill this application", "Hall Inc: Director of EventsAlready submitted."]);
    expect(p.$("matches").querySelectorAll("button")).toHaveLength(1);
  });

  it("fills the frame that knows the most questions, starts the submit watch and reports", async () => {
    const p = await popup({
      matches: [job],
      frames: [
        { frameId: 0, url: "https://careers.example/job/1" },
        { frameId: 4, url: "https://boards.greenhouse.io/x/jobs/1" },
        { frameId: 5, url: "https://ads.example/" },
      ],
      probe: { 0: 1, 4: 6, 5: null },
    });
    await p.click(p.button());
    expect(p.browser.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ["fill.js"] });
    expect(p.fetch.mock.calls[1][0]).toBe("https://lookout.test/api/ext/applications/app-1/packet");
    const fills = p.tabMessages.filter((m) => m.msg.type === "lookout-fill");
    expect(fills).toEqual([{ msg: expect.objectContaining({ appId: "app-1" }), frameId: 4 }]);
    expect(p.runtimeMessages).toEqual([{ type: "lookout-watch", tabId: 7, appId: "app-1", server: "https://lookout.test" }]);
    expect(p.button().textContent).toBe("Filled");
    expect(p.button().disabled).toBe(true);
    expect(p.$("after").hidden).toBe(false);
    expect(p.status()).toBe("Filled all 1. Check it, then press Submit on the page.");
  });

  it("lists the questions it couldn't fill first, with why", async () => {
    const p = await popup({
      matches: [job],
      probe: { 0: 3 },
      log: [
        { prompt: "First name", ok: true, how: "typed" },
        { prompt: "Work authorization", ok: false, how: "no matching option" },
        { prompt: "Email", ok: true, how: "typed" },
      ],
    });
    await p.click(p.button());
    expect(p.status()).toBe("Filled 2 of 3. Fill the red ones yourself.");
    expect(p.log()).toEqual([
      { text: "!Work authorization: no matching option", bad: true },
      { text: "✓First name", bad: false },
      { text: "✓Email", bad: false },
    ]);
  });

  it("says when no frame holds the form, and lets you try again", async () => {
    const p = await popup({ matches: [job], probe: { 0: 0 } });
    await p.click(p.button());
    expect(p.status()).toBe("Couldn't find the application form on this page. Open the job's Apply form and try again.");
    expect(p.tabMessages.some((m) => m.msg.type === "lookout-fill")).toBe(false);
    expect(p.runtimeMessages).toEqual([]);
    expect(p.button().disabled).toBe(false);
    expect(p.button().textContent).toBe("Fill this application");
  });

  it("stops when site access is refused or the packet can't load", async () => {
    const refused = await popup({ matches: [job], probe: { 0: 3 }, granted: false });
    await refused.click(refused.button());
    expect(refused.status()).toBe("Lookout Autofill needs access to job sites to fill the form.");
    expect(refused.fetch).toHaveBeenCalledTimes(1);

    const gone = await popup({ matches: [job], probe: { 0: 3 }, routes: { packet: { status: 404, body: { error: "Approve it in Lookout first." } } } });
    await gone.click(gone.button());
    expect(gone.status()).toBe("Approve it in Lookout first.");
    expect(gone.browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("marks it submitted by hand, and shows why when it can't", async () => {
    const p = await popup({ matches: [job], probe: { 0: 3 } });
    await p.click(p.button());
    await p.click(p.$("done"));
    expect(p.runtimeMessages.at(-1)).toEqual({ type: "lookout-mark", tabId: 7 });
    expect(p.status()).toBe("Marked as submitted in Lookout.");
    expect((p.$("done") as HTMLButtonElement).disabled).toBe(true);

    const q = await popup({ matches: [job], probe: { 0: 3 }, mark: { ok: false, error: "Fill an application in this tab first." } });
    await q.click(q.button());
    await q.click(q.$("done"));
    expect(q.status()).toBe("Fill an application in this tab first.");
    expect((q.$("done") as HTMLButtonElement).disabled).toBe(false);

    const r = await popup({ matches: [job], probe: { 0: 3 }, mark: null });
    await r.click(r.button());
    await r.click(r.$("done"));
    expect(r.status()).toBe("Couldn't reach Lookout.");
  });

  it("saves Settings, trims the token, and looks the page up again", async () => {
    const p = await popup({ cfg: null, matches: [job] });
    (p.$("server") as HTMLSelectElement).value = "https://staging.lookout.ericdevlin.co";
    (p.$("token") as HTMLInputElement).value = "  lkx_new  ";
    await p.click(p.$("save"));
    expect(p.stored.cfg).toEqual({ server: "https://staging.lookout.ericdevlin.co", token: "lkx_new" });
    expect(p.$("settings").hidden).toBe(true);
    expect(p.fetch.mock.calls[0][0]).toMatch(/^https:\/\/staging\.lookout\.ericdevlin\.co\/api\/ext\/match\?/);
    expect(p.rows()).toHaveLength(1);
  });

  it("toggles Settings from the gear", async () => {
    const p = await popup();
    expect(p.$("settings").hidden).toBe(true);
    await p.click(p.$("gear"));
    expect(p.$("settings").hidden).toBe(false);
    await p.click(p.$("gear"));
    expect(p.$("settings").hidden).toBe(true);
    expect(p.$("gear").getAttribute("aria-expanded")).toBe("false");
  });
});
