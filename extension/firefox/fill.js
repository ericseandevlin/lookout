/* Lookout Autofill: runs in every frame of the job page. Same field logic as Lookout's server worker (src/lib/application/submit.ts). */
(() => {
  if (window.__lookoutFill) return;
  window.__lookoutFill = true;

  const THANKS = /thank you for (applying|your application)|application (has been )?(received|submitted)|we('ve| have) received your application/i;
  const norm = (t) => (t || "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  /** The words a control is labeled with: <label for>, a wrapping label, aria-labelledby, aria-label. */
  function labelOf(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(l.textContent);
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) parts.push(document.getElementById(id)?.textContent || "");
    parts.push(el.getAttribute("aria-label") || "");
    return norm(parts.join(" "));
  }

  function sameText(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    return x === y || x.startsWith(y.slice(0, 80)) || y.startsWith(x.slice(0, 80));
  }

  function controlFor(prompt) {
    const all = [...document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [role=combobox]")];
    return all.find((el) => labelOf(el) === norm(prompt)) || all.find((el) => sameText(labelOf(el), prompt)) || null;
  }

  /** A "select any that apply" or radio question: one heading over several boxes. */
  function groupFor(prompt) {
    const key = norm(prompt).slice(0, 60);
    const groups = [...document.querySelectorAll("fieldset, [role=group], [role=radiogroup]")].filter((g) => norm(g.textContent).includes(key) && g.querySelector("input[type=checkbox], input[type=radio]"));
    return groups.pop() || null;
  }

  function fileInputFor(prompt, itemKind) {
    const inputs = [...document.querySelectorAll("input[type=file]")];
    for (const input of inputs) {
      let n = input.parentElement;
      for (let i = 0; n && i < 6; i++, n = n.parentElement) if (norm(n.textContent).includes(norm(prompt).slice(0, 40))) return input;
    }
    return itemKind === "cover_letter" ? inputs[1] || null : inputs[0] || null;
  }

  /** Same rule as pickOptions in src/lib/application/fillPlan.ts: one answer per line, exact text first, then a prefix either way. */
  function pickOptions(content, options) {
    const out = [];
    for (const part of (content || "").split(/\n+/).map((t) => t.trim()).filter(Boolean)) {
      const p = norm(part);
      const hit = (options || []).find((o) => norm(o) === p) || (options || []).find((o) => norm(o).startsWith(p) || p.startsWith(norm(o)));
      const label = hit || ((options || []).length ? null : part);
      if (label && !out.includes(label)) out.push(label);
    }
    return out;
  }

  /** Set a value the way typing would, so React and friends notice. */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitFor(fn, ms = 2500) {
    for (let t = 0; t < ms; t += 100) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }

  /** Custom dropdowns (react-select on Greenhouse, Ashby's own): open, type, click the matching option. */
  async function pickFromCombobox(el, answer) {
    const control = el.closest("[class*=control]") || el.parentElement;
    el.focus();
    control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    if (el.tagName === "INPUT") setValue(el, answer.slice(0, 40));
    const option = await waitFor(() => {
      const opts = [...document.querySelectorAll("[role=option]")].filter(visible);
      return opts.find((o) => norm(o.textContent) === norm(answer)) || opts.find((o) => sameText(o.textContent, answer));
    });
    if (!option) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { ok: false, how: "option not in the list" };
    }
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    option.click();
    await sleep(150);
    return { ok: true, how: "picked option" };
  }

  async function fillFile(step) {
    const input = fileInputFor(step.prompt, step.itemKind);
    if (!input || !step.file) return { ok: false, how: step.file ? "upload field not found" : "no file" };
    const bytes = Uint8Array.from(atob(step.file.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], step.file.name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(300);
    return { ok: true, how: "uploaded .docx" };
  }

  async function fillOne(step) {
    try {
      if (step.kind === "file") return await fillFile(step);
      const el = controlFor(step.prompt);
      if (!el) {
        const group = step.kind === "choice" ? groupFor(step.prompt) : null;
        if (!group) return { ok: false, how: "field not found" };
        const picks = pickOptions(step.content, step.options);
        if (!picks.length) return { ok: false, how: "answer matches no option" };
        for (const label of picks) {
          const box = [...group.querySelectorAll("input[type=checkbox], input[type=radio]")].find((b) => labelOf(b) === norm(label) || sameText(labelOf(b), label));
          if (!box) return { ok: false, how: `option not found: ${label.slice(0, 60)}` };
          if (!box.checked) box.click();
        }
        return { ok: true, how: `checked ${picks.length}` };
      }
      if (el.tagName === "SELECT") {
        const opt = [...el.options].find((o) => norm(o.textContent) === norm(step.content)) || [...el.options].find((o) => sameText(o.textContent, step.content));
        if (!opt) return { ok: false, how: "option not in the list" };
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, how: "selected" };
      }
      if (el.getAttribute("role") === "combobox" || step.kind === "choice") return await pickFromCombobox(el, step.content);
      setValue(el, step.content);
      return { ok: true, how: "typed" };
    } catch (e) {
      return { ok: false, how: String(e && e.message ? e.message : e).slice(0, 120) };
    }
  }

  /** Greenhouse's phone input has its own Country picker that isn't one of the questions. */
  async function phoneCountry(packet) {
    if (!packet.steps.some((s) => /^phone\b/i.test(s.prompt)) || packet.steps.some((s) => /^country\b/i.test(s.prompt))) return null;
    const el = [...document.querySelectorAll("[role=combobox], select")].find((c) => /^country$/.test(labelOf(c)));
    if (!el) return null;
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => /^united states(?!\s+minor)/i.test(o.textContent.trim()));
      if (!opt) return { prompt: "Phone country", ok: false, how: "United States not in the list" };
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { prompt: "Phone country", ok: true, how: "selected" };
    }
    const r = await pickFromCombobox(el, packet.phoneCountry || "United States");
    return { prompt: "Phone country", ...r };
  }

  function probe(packet) {
    let score = 0;
    for (const s of packet.steps) if (s.kind === "file" ? document.querySelector("input[type=file]") : controlFor(s.prompt) || groupFor(s.prompt)) score++;
    return { score };
  }

  /** After a real Submit click, watch for the thank-you message (pages that don't navigate). Navigations are watched by the background script. */
  function armWatcher(appId) {
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target.closest && e.target.closest("button, input[type=submit]");
        if (!b || !/submit|send application|apply/i.test(b.textContent || b.value || "")) return;
        browser.runtime.sendMessage({ type: "lookout-armed", appId });
        const obs = new MutationObserver(() => {
          const m = document.body.innerText.match(THANKS);
          if (m) {
            obs.disconnect();
            browser.runtime.sendMessage({ type: "lookout-thanks", appId, url: location.href, text: m[0] });
          }
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        setTimeout(() => obs.disconnect(), 120000);
      },
      true,
    );
  }

  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "lookout-probe") return probe(msg.packet);
    if (msg.type === "lookout-fill") {
      const log = [];
      for (const step of msg.packet.steps) {
        const r = await fillOne(step);
        log.push({ prompt: step.prompt, required: step.required, ok: r.ok, how: r.how });
      }
      const pc = await phoneCountry(msg.packet);
      if (pc) log.push(pc);
      armWatcher(msg.appId);
      return { log };
    }
  });
})();
