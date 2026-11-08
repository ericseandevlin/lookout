import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchPage's network half (#403): the connect-time DNS guard and each hop of a fetch, with DNS and undici's fetch stubbed.
const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));
const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("undici", async (orig) => ({ ...(await orig<typeof import("undici")>()), fetch: http.fetch }));

const { fetchPage, safeLookup, FetchError } = await import("./fetchPage");

type Addr = { address: string; family: number };
function resolveTo(addrs: Addr[] | Error) {
  dns.lookup.mockImplementation((_h: string, _o: unknown, cb: (e: Error | null, a?: Addr[]) => void) =>
    addrs instanceof Error ? cb(addrs) : cb(null, addrs),
  );
}
function look(all: boolean) {
  return new Promise<{ err: Error | null; addr: unknown; family?: number }>((done) =>
    safeLookup("jobs.example.com", { all }, (err, addr, family) => done({ err, addr, family })),
  );
}

describe("safeLookup", () => {
  beforeEach(() => {
    dns.lookup.mockReset();
  });

  it("asks DNS for every address", async () => {
    resolveTo([{ address: "8.8.8.8", family: 4 }]);
    await look(false);
    expect(dns.lookup).toHaveBeenCalledWith("jobs.example.com", { all: true }, expect.any(Function));
  });

  it("returns the whole list when undici asks for all", async () => {
    const list = [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700::1", family: 6 }];
    resolveTo(list);
    expect(await look(true)).toEqual({ err: null, addr: list, family: undefined });
  });

  it("returns the first address otherwise", async () => {
    resolveTo([{ address: "2606:4700::1", family: 6 }, { address: "8.8.8.8", family: 4 }]);
    expect(await look(false)).toEqual({ err: null, addr: "2606:4700::1", family: 6 });
  });

  // DNS rebinding: one private answer among public ones is enough to refuse.
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:7f00:1"])("refuses a host that resolves to %s", async (bad) => {
    resolveTo([{ address: "8.8.8.8", family: 4 }, { address: bad, family: bad.includes(":") ? 6 : 4 }]);
    const r = await look(true);
    expect(r.err?.message).toBe("Blocked address for jobs.example.com");
  });

  it("refuses an empty answer", async () => {
    resolveTo([]);
    expect((await look(true)).err?.message).toBe("Blocked address for jobs.example.com");
  });

  it("passes DNS errors through", async () => {
    const e = new Error("ENOTFOUND");
    resolveTo(e);
    expect((await look(true)).err).toBe(e);
  });
});

const page = (body: BodyInit | null, init: ResponseInit & { type?: string } = {}) =>
  new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/html; charset=utf-8", ...(init.headers as object) } });
const redirect = (location?: string, status = 302) => new Response(null, { status, headers: location ? { location } : {} });

describe("fetchPage", () => {
  beforeEach(() => {
    http.fetch.mockReset();
  });

  it("fetches with manual redirects, a timeout and the bot user agent", async () => {
    http.fetch.mockResolvedValueOnce(page("<p>hi</p>"));
    expect(await fetchPage("https://jobs.example.com/a")).toEqual({ url: "https://jobs.example.com/a", html: "<p>hi</p>" });
    const [url, opts] = http.fetch.mock.calls[0];
    expect(String(url)).toBe("https://jobs.example.com/a");
    expect(opts.redirect).toBe("manual");
    expect(opts.dispatcher).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.headers["user-agent"]).toMatch(/LookoutBot/);
  });

  it("follows relative and absolute redirects and reports the final URL", async () => {
    http.fetch
      .mockResolvedValueOnce(redirect("/b", 301))
      .mockResolvedValueOnce(redirect("https://boards.example.org/c", 307))
      .mockResolvedValueOnce(page("done"));
    expect(await fetchPage("https://jobs.example.com/a")).toEqual({ url: "https://boards.example.org/c", html: "done" });
    expect(http.fetch.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://jobs.example.com/a",
      "https://jobs.example.com/b",
      "https://boards.example.org/c",
    ]);
  });

  // Each hop is checked again, so a public page cannot bounce the fetch inward.
  it.each([
    ["http://127.0.0.1/admin", "That address isn't allowed"],
    ["http://[::ffff:7f00:1]/", "That address isn't allowed"],
    ["http://169.254.169.254/latest/meta-data/", "That address isn't allowed"],
    ["http://jobs.example.com:5432/", "That port isn't allowed"],
    ["file:///etc/passwd", "Only http and https links are supported"],
    ["http://u:p@jobs.example.com/", "Links with credentials aren't allowed"],
  ])("refuses a redirect to %s", async (loc, msg) => {
    http.fetch.mockResolvedValueOnce(redirect(loc));
    await expect(fetchPage("https://jobs.example.com/a")).rejects.toThrow(new FetchError(msg));
    expect(http.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect without a location", async () => {
    http.fetch.mockResolvedValueOnce(redirect());
    await expect(fetchPage("https://jobs.example.com/a")).rejects.toThrow("Redirect without a location");
  });

  it("stops after 4 hops", async () => {
    http.fetch.mockImplementation(async () => redirect("/again"));
    await expect(fetchPage("https://jobs.example.com/a")).rejects.toThrow("Too many redirects");
    expect(http.fetch).toHaveBeenCalledTimes(4);
  });

  it("reports an error status", async () => {
    http.fetch.mockResolvedValueOnce(page("gone", { status: 404 }));
    await expect(fetchPage("https://jobs.example.com/a")).rejects.toThrow("The page answered 404");
  });

  it.each(["application/pdf", "image/png", ""])("refuses content type %j", async (type) => {
    http.fetch.mockResolvedValueOnce(page("x", { type }));
    await expect(fetchPage("https://jobs.example.com/a")).rejects.toThrow("That link isn't a web page");
  });

  it.each(["application/json", "text/plain", "application/xml"])("accepts %s", async (type) => {
    http.fetch.mockResolvedValueOnce(page("ok", { type }));
    expect((await fetchPage("https://jobs.example.com/a")).html).toBe("ok");
  });

  it("returns empty html for a page with no body", async () => {
    http.fetch.mockResolvedValueOnce(page(null));
    expect(await fetchPage("https://jobs.example.com/a")).toEqual({ url: "https://jobs.example.com/a", html: "" });
  });

  it("stops reading at 2 MB and keeps what came before", async () => {
    const chunk = new Uint8Array(500_000).fill(97);
    let sent = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent++;
        c.enqueue(chunk);
      },
      cancel,
    });
    http.fetch.mockResolvedValueOnce(page(body));
    const { html } = await fetchPage("https://jobs.example.com/a");
    expect(html.length).toBe(2_000_000);
    expect(cancel).toHaveBeenCalled();
    expect(sent).toBeLessThan(10);
  });
});
