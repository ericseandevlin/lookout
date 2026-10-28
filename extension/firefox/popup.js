/* Lookout Autofill popup: find this tab's application, fill it, report what filled. */
const $ = (id) => document.getElementById(id);
let cfg = { server: "https://lookout.ericdevlin.co", token: "" };
let tab = null;

async function api(path, init = {}) {
  const res = await fetch(cfg.server + path, { ...init, headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lookout answered ${res.status}`);
  return data;
}

function say(text) {
  $("status").textContent = text;
  $("status").hidden = !text;
}

function showSettings(open) {
  $("settings").hidden = !open;
  $("gear").setAttribute("aria-expanded", String(open));
}

async function frameUrls() {
  const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
  return [...new Set([tab.url, ...frames.map((f) => f.url)].filter((u) => /^https?:/.test(u || "")))];
}

async function find() {
  $("matches").textContent = "";
  if (!cfg.token) {
    say("Add your extension token first.");
    showSettings(true);
    return;
  }
  say("Looking for this job in Lookout...");
  try {
    const qs = (await frameUrls()).map((u) => `url=${encodeURIComponent(u)}`).join("&");
    const { matches } = await api(`/api/ext/match?${qs}`);
    if (!matches.length) return say("No approved Lookout application for this page. Approve it in Lookout first, then open its apply page.");
    say("");
    for (const m of matches) {
      const li = document.createElement("li");
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = `${m.company}: ${m.title}`;
      li.append(t);
      if (m.status === "submitted") {
        const s = document.createElement("div");
        s.textContent = "Already submitted.";
        li.append(s);
      } else {
        const b = document.createElement("button");
        b.className = "solid";
        b.textContent = "Fill this application";
        b.onclick = () => fill(m.id, b);
        li.append(b);
      }
      $("matches").append(li);
    }
  } catch (e) {
    say(e.message);
  }
}

async function fill(appId, button) {
  button.disabled = true;
  button.textContent = "Filling...";
  try {
    const granted = await browser.permissions.request({ origins: ["<all_urls>"] }).catch(() => true);
    if (!granted) throw new Error("Lookout Autofill needs access to job sites to fill the form.");
    const packet = await api(`/api/ext/applications/${appId}/packet`);
    await browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["fill.js"] });
    // The form may sit in an embedded frame (a careers page wrapping Greenhouse). Fill the frame that knows the most questions.
    const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id });
    let best = null;
    for (const f of frames) {
      const r = await browser.tabs.sendMessage(tab.id, { type: "lookout-probe", packet }, { frameId: f.frameId }).catch(() => null);
      if (r && r.score > 0 && (!best || r.score > best.score)) best = { ...r, frameId: f.frameId };
    }
    if (!best) throw new Error("Couldn't find the application form on this page. Open the job's Apply form and try again.");
    const result = await browser.tabs.sendMessage(tab.id, { type: "lookout-fill", packet, appId }, { frameId: best.frameId });
    await browser.runtime.sendMessage({ type: "lookout-watch", tabId: tab.id, appId, server: cfg.server });
    report(result.log);
    button.textContent = "Filled";
    $("after").hidden = false;
  } catch (e) {
    button.disabled = false;
    button.textContent = "Fill this application";
    say(e.message);
  }
}

function report(log) {
  const ol = $("log");
  ol.textContent = "";
  const bad = log.filter((l) => !l.ok);
  say(bad.length ? `Filled ${log.length - bad.length} of ${log.length}. Fill the red ones yourself.` : `Filled all ${log.length}. Check it, then press Submit on the page.`);
  for (const l of [...bad, ...log.filter((x) => x.ok)]) {
    const li = document.createElement("li");
    const mark = document.createElement("span");
    mark.textContent = l.ok ? "✓" : "!";
    const text = document.createElement("span");
    text.textContent = l.ok ? l.prompt : `${l.prompt}: ${l.how}`;
    if (!l.ok) li.className = "bad";
    li.append(mark, text);
    ol.append(li);
  }
  ol.hidden = false;
}

$("gear").onclick = () => showSettings($("settings").hidden);
$("save").onclick = async () => {
  cfg = { server: $("server").value, token: $("token").value.trim() };
  await browser.storage.local.set({ cfg });
  showSettings(false);
  find();
};
$("done").onclick = async () => {
  const w = await browser.runtime.sendMessage({ type: "lookout-mark", tabId: tab.id });
  say(w && w.ok ? "Marked as submitted in Lookout." : (w && w.error) || "Couldn't reach Lookout.");
  $("done").disabled = !!(w && w.ok);
};

(async () => {
  const s = await browser.storage.local.get("cfg");
  if (s.cfg) cfg = s.cfg;
  $("server").value = cfg.server;
  $("token").value = cfg.token;
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  find();
})();
