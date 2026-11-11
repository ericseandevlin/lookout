/* Lookout Autofill background: after you press Submit, spot the thank-you page and mark the application Submitted in Lookout. */
const THANKS = /thank(?:s| you) for (?:applying|your application|submitting)|application (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b|we(?:'ve|’ve| have) (?:successfully )?received your application|successfully (?:applied|submitted)\b/i;

async function watches() {
  return (await browser.storage.session.get("watches")).watches || {};
}

async function saveWatches(w) {
  await browser.storage.session.set({ watches: w });
}

async function mark(tabId, url, text) {
  const w = await watches();
  const watch = w[tabId];
  if (!watch) return { ok: false, error: "Fill an application in this tab first." };
  const { cfg } = await browser.storage.local.get("cfg");
  if (!cfg || !cfg.token) return { ok: false, error: "Add your extension token in Settings." };
  try {
    const res = await fetch(`${watch.server}/api/ext/applications/${watch.appId}/submitted`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...(url ? { url: url.slice(0, 2000) } : {}), ...(text ? { text: text.slice(0, 300) } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `Lookout answered ${res.status}` };
    delete w[tabId];
    await saveWatches(w);
    await browser.action.setBadgeBackgroundColor({ tabId, color: "#2E7D32" });
    await browser.action.setBadgeText({ tabId, text: "✓" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

browser.runtime.onMessage.addListener(async (msg, sender) => {
  const w = await watches();
  if (msg.type === "lookout-watch") {
    w[msg.tabId] = { appId: msg.appId, server: msg.server, armed: false, until: Date.now() + 60 * 60_000 };
    await saveWatches(w);
    return { ok: true };
  }
  const tabId = msg.tabId ?? sender.tab?.id;
  if (msg.type === "lookout-armed" && w[tabId]) {
    w[tabId] = { ...w[tabId], armed: true, until: Date.now() + 15 * 60_000 };
    await saveWatches(w);
    return { ok: true };
  }
  if (msg.type === "lookout-thanks" && w[tabId]?.armed) return mark(tabId, msg.url, msg.text);
  if (msg.type === "lookout-mark") return mark(tabId);
});

// Pages that navigate to a confirmation page after Submit: check each page the armed tab loads.
browser.webNavigation.onCompleted.addListener(async ({ tabId, frameId, url }) => {
  const w = await watches();
  const watch = w[tabId];
  if (!watch || !watch.armed) return;
  if (Date.now() > watch.until) {
    delete w[tabId];
    return saveWatches(w);
  }
  const [r] = await browser.scripting
    .executeScript({ target: { tabId, frameIds: [frameId] }, func: (src) => (document.body?.innerText.match(new RegExp(src, "i")) || [null])[0], args: [THANKS.source] })
    .catch(() => []);
  if (r && r.result) await mark(tabId, url, r.result);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const w = await watches();
  if (w[tabId]) {
    delete w[tabId];
    await saveWatches(w);
  }
});
