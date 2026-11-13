import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/**
 * What a model call belongs to (#985). OpenRouter's Broadcast feature forwards these fields to PostHog, so the calls of
 * one search or one application show as one trace. The person is a hash: no email and no account id leaves the server.
 */
export type TraceContext = { flow: string; userId: string; id: string };

const store = new AsyncLocalStorage<TraceContext>();

/** Mark the rest of this async call as part of one piece of work. Call it once, where the work starts. */
export function traceAs(flow: string, userId: string, id: string) {
  store.enterWith({ flow, userId, id });
}

export const anonId = (userId: string) => `u_${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;

/** Request fields for OpenRouter. `step` is the name of the call, for example "queries" or "score". */
export function traceFields(step: string) {
  const t = store.getStore();
  if (!t) return { trace: { generation_name: step } };
  return {
    user: anonId(t.userId),
    session_id: t.id,
    trace: { trace_id: t.id, trace_name: t.flow, generation_name: step, flow: t.flow },
  };
}
