/** Pure rules for which run the board follows and when it reloads (#256). */

export type RunLike = { trigger: string; status: string };

export const isActiveRun = (r: { status: string } | null | undefined) => !!r && (r.status === "running" || r.status === "queued");

/**
 * The run the board panel follows, from runs newest first. Resume scans show on Materials and event searches on Events, so they are skipped.
 * An active search wins over a newer finished one: the agent can claim jobs out of order, and a finished run
 * must not end the board's polling while another search is still saving finds.
 */
export function pickBoardRun<T extends RunLike>(newestFirst: T[]): T | null {
  const runs = newestFirst.filter((r) => r.trigger !== "resume" && r.trigger !== "events");
  return runs.find(isActiveRun) ?? runs[0] ?? null;
}

/** While polling: keep showing progress, or reload the whole board because the run ended. */
export const nextPoll = (run: RunLike | null): "progress" | "reload" => (isActiveRun(run) ? "progress" : "reload");

/**
 * Wraps an async loader so only the newest call's result is applied.
 * An older /api/state response that lands late must not overwrite a newer board.
 */
export function latestOnly<T>(load: () => Promise<T>, apply: (v: T) => void) {
  let seq = 0;
  return async () => {
    const mine = ++seq;
    const v = await load();
    if (mine === seq) apply(v);
    return v;
  };
}
