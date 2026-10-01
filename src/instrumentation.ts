export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { migrate } = await import("./lib/db/migrate");
  await migrate();
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
