import "server-only";

/** The container's Chromium (Dockerfile installs it), for filling forms (#42) and printing PDFs (#106). */
export const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";

export async function launchChromium() {
  const { chromium } = await import("playwright-core");
  // The app container is read-only except /tmp; Chromium writes its profile, config and crash files under HOME.
  return chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    env: { ...process.env, HOME: "/tmp", XDG_CONFIG_HOME: "/tmp/.config", XDG_CACHE_HOME: "/tmp/.cache" },
  });
}
