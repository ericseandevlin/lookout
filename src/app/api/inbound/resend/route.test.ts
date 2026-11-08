import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const secret = "whsec_" + Buffer.from("test-secret-key-32-bytes-long!!!").toString("base64");
vi.hoisted(() => {
  process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("test-secret-key-32-bytes-long!!!").toString("base64");
});
// The real signature check; storage is stubbed so the route's own answers are what's tested.
const storeReceived = vi.fn();
vi.mock("@/lib/inbound", async (orig) => ({ ...(await orig<typeof import("@/lib/inbound")>()), storeReceived: (id: string) => storeReceived(id) }));

const { POST } = await import("./route");

const sign = (id: string, ts: string, body: string) =>
  "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
const hook = (body: string, signature?: string) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return POST(
    new Request("https://lookout.test/api/inbound/resend", {
      method: "POST",
      headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": signature ?? sign("msg_1", ts, body) },
      body,
    }),
  );
};
const received = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });

beforeEach(() => {
  storeReceived.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/inbound/resend (#503)", () => {
  it("stores a signed email.received event and returns what was stored", async () => {
    storeReceived.mockResolvedValue({ id: 7 });
    const res = await hook(received);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: { id: 7 } });
    expect(storeReceived).toHaveBeenCalledWith("em_1");
  });

  it("refuses a bad or missing signature without storing anything", async () => {
    expect((await hook(received, "v1,AAAA")).status).toBe(401);
    const res = await POST(new Request("https://lookout.test/api/inbound/resend", { method: "POST", body: received }));
    expect(res.status).toBe(401);
    expect(storeReceived).not.toHaveBeenCalled();
  });

  it("ignores other event types and events without an email id", async () => {
    for (const body of [JSON.stringify({ type: "email.sent", data: { email_id: "em_1" } }), JSON.stringify({ type: "email.received", data: {} }), "null"]) {
      const res = await hook(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    }
    expect(storeReceived).not.toHaveBeenCalled();
  });

  it("answers 400 to a signed body that isn't JSON, so Resend stops retrying", async () => {
    const res = await hook("not json");
    expect(res.status).toBe(400);
    expect(storeReceived).not.toHaveBeenCalled();
  });

  it("answers 502 when storing fails, so Resend retries", async () => {
    storeReceived.mockRejectedValue(new Error("Resend API down"));
    const res = await hook(received);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not store" });
  });
});
