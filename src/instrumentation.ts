import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { migrate } = await import("./lib/db/migrate");
  await migrate();
  const { featureOn } = await import("./lib/features");
  if (featureOn("DEMO")) {
    // Rebuild the public demo account (#1317) so its dates stay fresh after each deploy. A failure never stops the server.
    const { ensureDemo } = await import("./lib/demo");
    await ensureDemo();
  }
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}

/** Errors Next catches itself (page renders, server actions, routes not wrapped by lib/api) go to Admin > Errors (#12). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("./lib/errorLog");
  await recordError(context.routeType === "route" ? "route" : "render", err, { path: request.path, method: request.method, digest: (err as { digest?: string }).digest });
};
