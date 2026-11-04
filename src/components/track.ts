"use client";

import type { ClientEvent } from "@/lib/events";

/** Report one of the browser-only events (#35). Fire and forget; keepalive lets it outlive a page change. */
export function trackClient(type: ClientEvent, target?: string | null) {
  fetch("/api/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, target: target ?? null }) }).catch(() => {});
}
