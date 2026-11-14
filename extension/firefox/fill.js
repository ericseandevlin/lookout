/* Lookout Autofill: runs in every frame of the job page. Same field logic as Lookout's server worker (src/lib/application/submit.ts). */
(() => {
  if (window.__lookoutFill) return;
  window.__lookoutFill = true;

  const THANKS = /(?<!\b(?:once|after|when|if|before|until|upon)\b[^.!?\n]{0,40})(?:thank(?:s| you) for (?:applying|your application|submitting|your submission)|(?<!\bno\s+)(?:application|submission|candidacy) (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b|application (?:for|to|with) [^.!?\n]{1,80}? (?:has been|was) (?:successfully )?(?:received|submitted|sent)\b|we(?:'ve|’ve| have)? (?:successfully )?(?:received|got) your (?:application|submission)|(?<!(?:\bnot|\bnever|n't|n’t)\s+(?:(?:be|been|yet)\s+){0,2})\bsuccessfully (?:applied|submitted)\b)/i;
  // Lever marks required questions with "✱", others with "*": neither is part of the question (#1150).
  const norm = (t) => (t || "").replace(/[*✱]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  /** A heading without a trailing "(required)": "How did you hear about us? (required)" is that question (#1150). */
  const bare = (t) => t.replace(/\s*\(required\)$/, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  /** Does a sibling branch at any level between `descendant` and `container` have the key text? (#913) */
  function siblingHas(container, descendant, key) {
    let cur = descendant.parentElement;
    while (cur && cur !== container) {
      for (const sibling of [...cur.parentElement.children].filter((c) => c !== cur)) {
        const t = norm(sibling.textContent);
        if (!t.includes(key)) continue;
        // The field's own label beside the input's wrapper ("Cover Letter" over <div><input type=file></div>)
        // names this input, not another branch (#1067). A sentence that only mentions it still blocks (#913).
        if (t.startsWith(key) && !sibling.querySelector("input, textarea, select, button")) continue;
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

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

  /** What a "question + option" label says past the question and a "(required)" mark ("*" and "✱" are already gone) (#1160, #1179). */
  function optionAfter(label, prompt) {
    return label.slice(norm(prompt).length).replace(/^\s*\(required\)/, "").trim();
  }

  function sameText(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    return x === y || x.startsWith(y.slice(0, 80)) || y.startsWith(x.slice(0, 80));
  }

  /**
   * The control labeled with the question: the exact label first, then a label that holds the question, same as the worker
   * (#698). A shorter label the question only starts with is another field: "Location" is not "Location: can you work
   * onsite?" (#888). Long labels (80+ characters) match on their first 80, as in pickOne.
   */
  function labeledBy(all, prompt) {
    const q = norm(prompt);
    const long = (el) => Math.min(labelOf(el).length, q.length) >= 80 && sameText(labelOf(el), prompt);
    return all.find((el) => labelOf(el) === q) || all.find((el) => labelOf(el).includes(q)) || all.find(long) || null;
  }

  function controlFor(prompt) {
    return labeledBy([...document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [role=combobox]")], prompt);
  }

  /** A lone checkbox labeled with the question itself ("I agree to the privacy policy", #669). */
  function checkboxFor(prompt) {
    const all = [...document.querySelectorAll("input[type=checkbox]")];
    const q = norm(prompt);
    // Several boxes each labeled "question + option" are a group, not one consent box: the first would be "No" (#1091).
    if (!all.some((el) => labelOf(el) === q) && all.filter((el) => labelOf(el).includes(q)).length > 1) return null;
    return labeledBy(all, prompt);
  }

  /** A group's own question: its <legend>, else its aria-labelledby or aria-label. */
  function groupName(g) {
    const legend = [...g.children].find((c) => c.tagName === "LEGEND");
    return legend ? norm(legend.textContent) : labelOf(g);
  }

  /** A "select any that apply" or radio question: one heading over several boxes. */
  function groupFor(prompt) {
    const key = norm(prompt).slice(0, 60);
    // A group named by aria-labelledby can have its question outside it, as the worker reads it (#951).
    const groups = [...document.querySelectorAll("fieldset, [role=group], [role=radiogroup]")].filter((g) => (norm(g.textContent).includes(key) || groupName(g).includes(key)) && g.querySelector("input[type=checkbox], input[type=radio]"));
    // The group named by the question itself first: "Do you require sponsorship?" is not the later
    // "Do you require sponsorship? (now or in the future)", which also contains its text (#720).
    // Next a group whose own name starts with the question: "Do you require sponsorship? (required)" beats a later group
    // that only quotes it ("If you answered Yes to "Do you require sponsorship?", which visa?") (#1044).
    const q = norm(prompt);
    return groups.filter((g) => groupName(g) === q).pop() || groups.filter((g) => groupName(g).startsWith(q)).pop() || groups.pop() || null;
  }

  /**
   * The boxes that answer the question inside its group. A section fieldset ("Additional questions") can hold several
   * questions, each a heading and boxes with no fieldset of its own: take the boxes right after the question, never the
   * first "No" or "Other" in the section, which belongs to an earlier question (#1044, #1111).
   */
  function boxesFor(group, prompt) {
    const boxes = [...group.querySelectorAll("input[type=checkbox], input[type=radio]")];
    const q = norm(prompt);
    const key = q.slice(0, 60);
    if (groupName(group).includes(key)) return boxes;
    // The question's own text, not a box's wrapper: the heading that is the prompt, then one that starts with it, then
    // the first that holds it. A later question that quotes it ("If you answered Yes to ...") is not it (#1111).
    const texts = [...group.querySelectorAll("*")].filter((el) => !el.querySelector("input") && norm(el.textContent).includes(key));
    const question = texts.find((el) => norm(el.textContent) === q) || texts.find((el) => norm(el.textContent).startsWith(q)) || texts[0];
    if (!question) return boxes;
    const after = (b) => question.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    const next = boxes.find(after);
    if (!next) return boxes;
    if (next.type === "radio") return boxes.filter((b) => b.type === "radio" && b.name === next.name);
    // Checkboxes: the ones after the question in the nearest block that holds them, so "Other" is this question's.
    let scope = question.parentElement;
    while (scope && scope !== group && !scope.contains(next)) scope = scope.parentElement;
    return boxes.filter((b) => b.type === "checkbox" && after(b) && (!scope || scope.contains(b)));
  }

  /** Radios labeled with the question and their option ("Can you work onsite? No"), no group around them (#773). */
  function radiosFor(prompt) {
    const q = norm(prompt) + " ";
    return [...document.querySelectorAll("input[type=radio]")].filter((el) => labelOf(el).startsWith(q));
  }

  /**
   * The text matched only in another branch of this container that holds its own upload box: a section with a shallow
   * Cover Letter box and a deeper Resume box must not hand the resume to the cover letter's input (#1085).
   */
  function otherBoxHas(container, input, key) {
    for (let cur = input; cur.parentElement && cur !== container; cur = cur.parentElement)
      for (const sibling of cur.parentElement.children)
        if (sibling !== cur && sibling.querySelector("input[type=file]") && norm(sibling.textContent).includes(key)) return true;
    return false;
  }

  function fileInputFor(prompt, itemKind) {
    const inputs = [...document.querySelectorAll("input[type=file]")];
    const key = norm(prompt).slice(0, 40);
    // Nearest labeled box wins, one level at a time: a section holding both uploads holds both labels (#590).
    // A cover letter's prompt must not match a resume input whose outer ancestor happens to hold the text
    // in a sibling subtree (#913): verify the matching text is in the input's own branch, not a sibling.
    for (let depth = 0; depth < 6; depth++)
      for (const input of inputs) {
        let n = input.parentElement;
        for (let i = 0; n && i < depth; i++) n = n.parentElement;
        if (!n || !norm(n.textContent).includes(key)) continue;
        if (depth > 0 && (itemKind === "cover_letter" ? siblingHas(n, input, key) : otherBoxHas(n, input, key))) continue;
        return input;
      }
    // Unlabeled, only the resume takes the first upload and the letter the second. Any other upload (writing sample,
    // portfolio) would replace the resume there, so it reports not found instead (#1030).
    return itemKind === "cover_letter" ? inputs[1] || null : itemKind === "resume" ? inputs[0] || null : null;
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
  function answersBox(answer) {
    const a = norm(answer);
    return !a || checksBox(a) || /^(no|false)\b/.test(a);
  }

  function checksBox(answer) {
    return /^(yes|true|(i(( have|'ve|’ve)? read| understand) and |read and |i (hereby )?)?(agreed?|acknowledged?|confirm(ed)?|consent(ed)?|certif(y|ied)|accept(ed)?|authori[sz]e[ds]?|attest(ed)?|affirm(ed)?)|(i(( have|'ve|’ve)? read and)? |read and )?underst(and|ood))\b/.test(norm(answer));
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

  /** The answer's first number, same as the worker: "$165k" is 165000 (#1168), "$120-150k" is 120000 (#1254). */
  function numberAnswer(t) {
    const m = String(t || "").match(/(\d[\d,]*(?:\.\d+)?)([km]\b)?(?:\s*(?:-|–|—|to)\s*\$?\d[\d,]*(?:\.\d+)?([km]\b))?/i);
    if (!m) return "";
    const n = m[1].replace(/,/g, "");
    const unit = m[2] || (Number(n) < 1000 ? m[3] : undefined);
    return unit ? String(Math.round(Number(n) * (unit.toLowerCase() === "k" ? 1e3 : 1e6))) : n;
  }

  /**
   * A date field keeps only yyyy-mm-dd and drops anything else without a word, so "12/01/2026" or "December 1, 2026"
   * is turned into "2026-12-01" first; "" when the answer holds no date. Same as the worker (#1242).
   */
  function dateAnswer(t) {
    const s = String(t || "");
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "");
    const mon = (w) => months.indexOf(w.slice(0, 3).toLowerCase()) + 1;
    let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (m) return iso(+m[3], +m[1], +m[2]);
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
    if (m) return iso(+m[3], mon(m[1]), +m[2]);
    m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i);
    if (m) return iso(+m[3], mon(m[2]), +m[1]);
    return "";
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
    // One line of the answer: open the list, match it, and type it (never the whole answer) when it isn't showing.
    const pickLine = async (line) => {
      const find = () => {
        const opts = options();
        return matches ? opts.find((o) => matches(o.textContent)) : opts[pickOne(line, opts.map((o) => o.textContent))];
      };
      press(el);
      let option = await waitFor(find, 1500);
      const multi = multiSelect(el);
      if (!option && el.tagName === "INPUT") {
        setValue(el, line.slice(0, 40));
        option = await waitFor(find, 1500);
      }
      if (!option) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { ok: false, how: options().length ? "option not in the list" : "list didn't open" };
      }
      option.scrollIntoView({ block: "nearest" });
      press(option);
      await sleep(200);
      return { ok: true, how: "picked option", multi: multi || multiSelect(el) };
    };
    // Several lines are several choices (#1126): each one on a multi-select, else the first and the rest reported
    // not filled. Picking only the first and saying "picked option" dropped "Remote" from "Boston\nRemote". Same as the worker.
    const lines = matches ? [answer] : (answer || "").split(/\n+/).map((t) => t.trim()).filter(Boolean);
    if (lines.length < 2) {
      const { ok, how } = await pickLine(lines[0] || answer || "");
      return { ok, how };
    }
    for (const [i, line] of lines.entries()) {
      const r = await pickLine(line);
      if (!r.ok) return { ok: false, how: `${r.how}: ${line.slice(0, 60)}` };
      if (i === 0 && !r.multi) return { ok: false, how: `one choice only, not filled: ${lines.slice(1).join(", ").slice(0, 60)}` };
    }
    return { ok: true, how: `picked ${lines.length} options` };
  }

  /** A dropdown that keeps several choices: aria-multiselectable on it or its open list, or react-select's multi value box. */
  function multiSelect(el) {
    return (
      el.getAttribute("aria-multiselectable") === "true" ||
      !!el.closest("[aria-multiselectable=true], [class*=--is-multi]") ||
      [...document.querySelectorAll("[role=listbox][aria-multiselectable=true]")].some(visible)
    );
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
      const found = controlFor(step.prompt);
      // A choice whose group is named by the question beats a box whose label only holds it: "How did you hear about us?"
      // is not "If other, how did you hear about us?" (#952). Same as the worker.
      const named = found && step.kind === "choice" && labelOf(found) !== norm(step.prompt) ? groupFor(step.prompt) : null;
      const el = named && bare(groupName(named)) === norm(step.prompt) ? null : found;
      // A lone box labeled with the question is the answer's field for any kind, before the group and radio lookup,
      // same as the worker: a Yes/No question can be one "I consent" box (#940).
      const box = el ? null : checkboxFor(step.prompt);
      if (!el && (box || step.kind !== "choice")) {
        if (!box) return { ok: false, how: "field not found" };
        // A box whose label only holds the question is a text answer's field only if the answer is a yes or a no:
        // a LinkedIn URL must not untick "I don't have a LinkedIn profile" (#1112). Same rule as answersBox in fillPlan.ts.
        if (step.kind !== "choice" && labelOf(box) !== norm(step.prompt) && !answersBox(step.content)) return { ok: false, how: "field not found" };
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
          // What follows the question, past a "(required)" mark ("*" and "✱" are already gone), is the option (#1160).
          const radio = radios.find((r) => optionAfter(labelOf(r), step.prompt) === norm(step.options[i]));
          if (!radio) return { ok: false, how: `option not found: ${step.options[i].slice(0, 60)}` };
          if (!radio.checked) radio.click();
          return { ok: true, how: "checked 1" };
        }
        // Radios take one answer: the first line that lands, same as the worker.
        const boxes = boxesFor(group, step.prompt);
        const picks = pickOptions(step.content, step.options).slice(0, boxes.some((b) => b.type === "radio") ? 1 : undefined);
        if (!picks.length) return { ok: false, how: "answer matches no option" };
        for (const label of picks) {
          // Exact label first: the loose match alone puts "None of the above" on the "No" box (#632).
          // A box labeled with the question and its option ("Are you 18 or older? Yes") is that option (#1091).
          const box =
            boxes.find((b) => labelOf(b) === norm(label)) ||
            // Past a "(required)" mark too, as for radios outside a group (#1179).
            boxes.find((b) => labelOf(b).startsWith(norm(step.prompt)) && optionAfter(labelOf(b), step.prompt) === norm(label)) ||
            // A loose match needs a whole-word prefix: "No" is "No (I am not a veteran)", never "None of the above" (#1181).
            // Past 80 characters a label may hold a cut-off answer, so the plain prefix still counts there.
            boxes.find((b) => startsWord(norm(label), labelOf(b)) || startsWord(labelOf(b), norm(label))) ||
            boxes.find((b) => Math.min(labelOf(b).length, norm(label).length) >= 80 && sameText(labelOf(b), label));
          if (!box) return { ok: false, how: `option not found: ${label.slice(0, 60)}` };
          if (!box.checked) box.click();
        }
        return { ok: true, how: `checked ${picks.length}` };
      }
      if (el.tagName === "SELECT") {
        const labels = [...el.options].map((o) => o.textContent);
        // Several lines are several choices, as for custom dropdowns (#1126, #1132): every line on a <select multiple>,
        // else the first and the rest reported not filled. Same as the worker.
        const lines = (step.content || "").split(/\n+/).map((t) => t.trim()).filter(Boolean);
        if (lines.length > 1) {
          const picks = lines.map((l) => pickOne(l, labels));
          if (!el.multiple) {
            const first = el.options[picks[0]];
            if (!first) return { ok: false, how: "option not in the list" };
            el.value = first.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return { ok: false, how: `one choice only, not filled: ${lines.slice(1).join(", ").slice(0, 60)}` };
          }
          const miss = lines.find((_, n) => picks[n] < 0);
          if (miss) return { ok: false, how: `option not in the list: ${miss.slice(0, 60)}` };
          [...el.options].forEach((o, n) => (o.selected = picks.includes(n)));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, how: `selected ${new Set(picks).size}` };
        }
        const opt = el.options[pickOne(step.content, labels)];
        if (!opt) return { ok: false, how: "option not in the list" };
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, how: "selected" };
      }
      if (el.getAttribute("role") === "combobox" || step.kind === "choice") return await pickFromCombobox(el, step.content);
      // A number field drops "$165,000": fill the first number in the answer, and never call an empty field typed (#1140).
      if (el instanceof HTMLInputElement && el.type === "number") {
        const n = numberAnswer(step.content);
        if (!n) return { ok: false, how: "number field, answer has no number" };
        setValue(el, n);
        if (el.value === "") return { ok: false, how: "field rejected the answer" };
        return { ok: true, how: "typed" };
      }
      if (el instanceof HTMLInputElement && el.type === "date") {
        const d = dateAnswer(step.content);
        if (!d) return { ok: false, how: "date field, answer is not a date" };
        setValue(el, d);
        if (el.value === "") return { ok: false, how: "field rejected the answer" };
        return { ok: true, how: "typed" };
      }
      setValue(el, step.content);
      // Any field that drops what was typed is not filled, so the popup never says "Filled all" over a blank (#1242).
      if ("value" in el && el.value === "" && String(step.content || "").trim()) return { ok: false, how: "field rejected the answer" };
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
