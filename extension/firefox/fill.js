/* Lookout Autofill: runs in every frame of the job page. Same field logic as Lookout's server worker (src/lib/application/submit.ts). */
(() => {
  if (window.__lookoutFill) return;
  window.__lookoutFill = true;

  const THANKS = /thank(?:s| you) for (?:applying|your application|submitting|your submission)|(?:application|submission|candidacy) (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b|application for [^.!?\n]{1,80}? (?:has been|was) (?:successfully )?(?:received|submitted|sent)\b|we(?:'ve|’ve| have)? (?:successfully )?(?:received|got) your (?:application|submission)|successfully (?:applied|submitted)\b/i;
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
    // Greenhouse labels a field twice (<label for> and aria-labelledby with the same text); count it once.
    return [...new Set(parts.map(norm).filter(Boolean))].join(" ");
  }

  /** What a real click sends. React pickers ignore a lone synthetic mousedown but open on the full sequence. */
  function press(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, clientX: r.x + 5, clientY: r.y + 5, view: window };
    const p = { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", p));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    if (typeof el.focus === "function") el.focus();
    el.dispatchEvent(new PointerEvent("pointerup", { ...p, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...o, buttons: 0 }));
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

  /** A lone checkbox labeled with the question itself ("I agree to the privacy policy", #669). */
  function checkboxFor(prompt) {
    const all = [...document.querySelectorAll("input[type=checkbox]")];
    return all.find((el) => labelOf(el) === norm(prompt)) || all.find((el) => sameText(labelOf(el), prompt)) || null;
  }

  /** A group's own question: its <legend>, else its aria-labelledby or aria-label. */
  function groupName(g) {
    const legend = [...g.children].find((c) => c.tagName === "LEGEND");
    return legend ? norm(legend.textContent) : labelOf(g);
  }

  /** A "select any that apply" or radio question: one heading over several boxes. */
  function groupFor(prompt) {
    const key = norm(prompt).slice(0, 60);
    const groups = [...document.querySelectorAll("fieldset, [role=group], [role=radiogroup]")].filter((g) => norm(g.textContent).includes(key) && g.querySelector("input[type=checkbox], input[type=radio]"));
    // The group named by the question itself first: "Do you require sponsorship?" is not the later
    // "Do you require sponsorship? (now or in the future)", which also contains its text (#720).
    return groups.filter((g) => groupName(g) === norm(prompt)).pop() || groups.pop() || null;
  }

  /** Radios labeled with the question and their option ("Can you work onsite? No"), no group around them (#773). */
  function radiosFor(prompt) {
    const q = norm(prompt) + " ";
    return [...document.querySelectorAll("input[type=radio]")].filter((el) => labelOf(el).startsWith(q));
  }

  function fileInputFor(prompt, itemKind) {
    const inputs = [...document.querySelectorAll("input[type=file]")];
    const key = norm(prompt).slice(0, 40);
    // Nearest labeled box wins, one level at a time: a section holding both uploads holds both labels (#590).
    for (let depth = 0; depth < 6; depth++)
      for (const input of inputs) {
        let n = input.parentElement;
        for (let i = 0; n && i < depth; i++) n = n.parentElement;
        if (n && norm(n.textContent).includes(key)) return input;
      }
    return itemKind === "cover_letter" ? inputs[1] || null : inputs[0] || null;
  }

  /** a starts b and ends on a word boundary there: "no" starts "no, thanks" but not "none" (#632). A blank option starts nothing (#722). */
  const startsWord = (a, b) => !!a && b.startsWith(a) && (b.length === a.length || /\W/.test(b[a.length]) || /\W/.test(a[a.length - 1]));

  /**
   * Same rule as pickOptions in src/lib/application/fillPlan.ts: one answer per line, exact text first, then a prefix
   * either way, at a word boundary, closest length first.
   */
  function pickOptions(content, options) {
    const out = [];
    for (const part of (content || "").split(/\n+/).map((t) => t.trim()).filter(Boolean)) {
      const p = norm(part);
      const near = (options || []).filter((o) => startsWord(norm(o), p) || startsWord(p, norm(o))).sort((a, b) => Math.abs(norm(a).length - p.length) - Math.abs(norm(b).length - p.length));
      const hit = (options || []).find((o) => norm(o) === p) || near[0];
      const label = hit || ((options || []).length ? null : part);
      if (label && !out.includes(label)) out.push(label);
    }
    return out;
  }

  /** Same rule as checksBox in src/lib/application/fillPlan.ts: yes, true or a consent verb (past tense too, #681), alone or leading the answer. */
  function checksBox(answer) {
    return /^(yes|true|(i(( have|'ve|’ve)? read| understand) and |i )?(agreed?|acknowledged?|confirm(ed)?|consent(ed)?|certif(y|ied)|accept(ed)?)|i understand)\b/.test(norm(answer));
  }

  /**
   * The index of the one option a dropdown answer means: exact text, then the pickOptions rule, then the long-label
   * match (first 80 characters). A plain prefix put "No" on "None of the above" (#644). Same rule as pickOne in fillPlan.ts (#695).
   */
  function pickOne(answer, labels) {
    const a = norm(answer);
    const exact = labels.findIndex((l) => norm(l) === a);
    if (exact >= 0) return exact;
    const [hit] = pickOptions(answer, labels);
    if (hit != null) return labels.indexOf(hit);
    return labels.findIndex((l) => Math.min(a.length, norm(l).length) >= 80 && sameText(l, answer));
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

  /**
   * Custom dropdowns (react-select on Greenhouse, Ashby's own, intl-tel-input's country list): open with a real-looking
   * click, match against the open list, and type to filter only when the answer isn't showing.
   */
  async function pickFromCombobox(el, answer, matches) {
    const options = () => [...document.querySelectorAll("[role=option], [class*=select__option]")].filter(visible);
    const find = () => {
      const opts = options();
      return matches ? opts.find((o) => matches(o.textContent)) : opts[pickOne(answer, opts.map((o) => o.textContent))];
    };
    press(el);
    let option = await waitFor(find, 1500);
    if (!option && el.tagName === "INPUT") {
      setValue(el, answer.slice(0, 40));
      option = await waitFor(find, 1500);
    }
    if (!option) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { ok: false, how: options().length ? "option not in the list" : "list didn't open" };
    }
    option.scrollIntoView({ block: "nearest" });
    press(option);
    await sleep(200);
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
      if (!el && step.kind !== "choice") {
        const box = checkboxFor(step.prompt);
        if (!box) return { ok: false, how: "field not found" };
        if (!checksBox(step.content)) {
          if (step.required) return { ok: false, how: "answer is not a yes" };
          // A box the site ticked ahead ("Send me job alerts") goes out the way they answered (#788).
          if (box.checked) box.click();
          return { ok: true, how: "left unchecked" };
        }
        if (!box.checked) box.click();
        return { ok: true, how: "checked" };
      }
      if (!el) {
        const group = groupFor(step.prompt);
        if (!group) {
          // Check the radio the answer means, never the first one found, same as the worker (#720, #773).
          const radios = radiosFor(step.prompt);
          if (!radios.length) return { ok: false, how: "field not found" };
          const i = step.options && step.options.length ? pickOne(step.content, step.options) : -1;
          if (i < 0) return { ok: false, how: "answer matches no option" };
          const radio = radios.find((r) => labelOf(r) === norm(step.prompt) + " " + norm(step.options[i]));
          if (!radio) return { ok: false, how: `option not found: ${step.options[i].slice(0, 60)}` };
          if (!radio.checked) radio.click();
          return { ok: true, how: "checked 1" };
        }
        // Radios take one answer: the first line that lands, same as the worker.
        const picks = pickOptions(step.content, step.options).slice(0, group.querySelector("input[type=radio]") ? 1 : undefined);
        if (!picks.length) return { ok: false, how: "answer matches no option" };
        for (const label of picks) {
          // Exact label first: the loose match alone puts "None of the above" on the "No" box (#632).
          const boxes = [...group.querySelectorAll("input[type=checkbox], input[type=radio]")];
          const box = boxes.find((b) => labelOf(b) === norm(label)) || boxes.find((b) => sameText(labelOf(b), label));
          if (!box) return { ok: false, how: `option not found: ${label.slice(0, 60)}` };
          if (!box.checked) box.click();
        }
        return { ok: true, how: `checked ${picks.length}` };
      }
      if (el.tagName === "SELECT") {
        const opt = el.options[pickOne(step.content, [...el.options].map((o) => o.textContent))];
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
    const r = await pickFromCombobox(el, packet.phoneCountry || "United States", (text) => /^\s*united states(?!\s+minor)/i.test(text));
    return { prompt: "Phone country", ...r };
  }

  function probe(packet) {
    let score = 0;
    for (const s of packet.steps) if (s.kind === "file" ? document.querySelector("input[type=file]") : controlFor(s.prompt) || groupFor(s.prompt) || checkboxFor(s.prompt) || radiosFor(s.prompt).length) score++;
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
        // Posting text on the page can already match, so only a thank-you past the ones there at the click counts (#784).
        const matches = () => document.body.innerText.match(new RegExp(THANKS.source, "gi")) || [];
        const seen = matches().length;
        const obs = new MutationObserver(() => {
          const m = matches()[seen];
          if (m) {
            obs.disconnect();
            browser.runtime.sendMessage({ type: "lookout-thanks", appId, url: location.href, text: m });
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
