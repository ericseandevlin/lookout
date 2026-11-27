/* Lookout Autofill: runs in every frame of the job page. Same field logic as Lookout's server worker (src/lib/application/submit.ts). */
(() => {
  if (window.__lookoutFill) return;
  window.__lookoutFill = true;

  const THANKS = /(?<!\b(?:once|after|when|if|before|until|upon)\b[^.!?\n]{0,40})(?<!\b(?:could(?:n['’]t| not)|can(?:['’]t|not)|(?:unable|failed) to)\s+(?:confirm|verify|tell|determine|check|ensure|guarantee)\b[^.!?\n]{0,40})(?:thank(?:s|[ -]?you) for (?:applying|your application|submitting|your submission)|(?<!\bno\s+)(?:application|submission|candidacy) (?:has been |was )?(?:successfully )?(?:received|submitted|sent)\b|application (?:for|to|with) [^.!?\n]{1,80}? (?:has been|was) (?:successfully )?(?:received|submitted|sent)\b|we(?:'ve|’ve| have)? (?:successfully )?(?:received|got) your (?:application|submission)|you(?:'ve|’ve| have) (?:successfully )?submitted your (?:application|submission)\b|(?<!(?:\bnot|\bnever|n't|n’t)\s+(?:(?:be|been|yet)\s+){0,2})\bsuccessfully (?:applied|submitted)\b|(?<!\b(?:sure|ensure|check|confirm|verify)\s+(?:that\s+)?(?:your\s+|the\s+)?)\b(?:application|submission) (?:is |has been |was )?(?:now |successfully )?completed?(?=\s*(?:[.!\n]|$))|(?<!(?:\bnot|\bnever|n't|n’t)\s+(?:(?:be|been|yet)\s+){0,2})\bapplied successfully\b|you(?:'ve|’ve| have) successfully completed (?:the|your) application\b|(?<!\b(?:sure|ensure|check|confirm|verify)\s+(?:that\s+)?)\byour application is in(?=\s*(?:[.!\n]|$))|(?:r[eé]sum[eé]|cv) (?:has been|was) (?:successfully )?submitted\b|you(?:'ve|’ve| have) (?:successfully |now )?applied(?: (?:to|for) (?![^.!?\n]*\b(?:before|previously|already)\b)[^.!?\n]{1,80}?)?(?=\s*(?:[.!\n]|$)))/i;
  // Lever marks required questions with "✱", others with "*": neither is part of the question (#1150). Curly quotes
  // match straight ones: "I don't wish to answer" is "I don’t wish to answer" (#1255). An en or em dash, spaced or not, is
  // a hyphen: "Yes - I am authorized" is "Yes – I am authorized" (#ISSUE).
  const norm = (t) => (t || "").replace(/[*✱]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s*[‐‑‒–—―-]\s*/g, " - ").replace(/\s+/g, " ").trim().toLowerCase();
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

  /**
   * A label's own words, with a space between its elements. React writes no whitespace between tags, so textContent reads
   * "<span>Website</span><span>Include https://</span>" as "websiteinclude https://" (#1397). A <select>, <textarea> or
   * <datalist> inside it adds its options and text, not words of the label (#1398).
   */
  function ownText(node) {
    if (!node) return "";
    const out = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) if (!t.parentElement?.closest("select, textarea, datalist")) out.push(t.nodeValue);
    return out.join(" ");
  }

  /** The words a control is labeled with: <label for>, a wrapping label, aria-labelledby, aria-label. */
  function labelOf(el) {
    const parts = [];
    // aria-labelledby first, in its own order, as a screen reader reads it: "q ly" is the question, then the option's
    // <label for>. Labels first read "yes can you work onsite?" and the question never matched (#1408).
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) parts.push(ownText(document.getElementById(id)));
    if (el.labels) for (const l of el.labels) parts.push(ownText(l));
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

  /**
   * What a "question + option" label says past the question and a "(required)" or "(optional)" mark ("*" and "✱" are
   * already gone) (#1160, #1179, #1769).
   */
  function optionAfter(label, prompt) {
    return label.slice(norm(prompt).length).replace(/^\s*\((?:required|optional)\)/, "").trim();
  }

  function sameText(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    return x === y || x.startsWith(y.slice(0, 80)) || y.startsWith(x.slice(0, 80));
  }

  /**
   * The control labeled with the question: the exact label first, then a label that holds the question, same as the worker
   * (#698). A shorter label the question only starts with is another field: "Location" is not "Location: can you work
   * onsite?" (#888). Long labels (80+ characters) match on their first 80, as in pickOne. A "(required)" or "(optional)"
   * mark is not part of the label, and a label holds the question only as whole words: "City" is not in "Ethnicity" (#1253).
   */
  function labeledBy(all, prompt) {
    const q = norm(prompt);
    const own = (el) => labelOf(el).replace(/\s*\((?:required|optional)\)$/, "");
    const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
    const long = (el) => Math.min(labelOf(el).length, q.length) >= 80 && sameText(labelOf(el), prompt);
    // Two controls with the question's own label: the phone's Country picker is not the "Country" question (#1498).
    const exact = all.filter((el) => own(el) === q);
    return (exact.length > 1 && exact.find((el) => !isPhoneCountry(el))) || exact[0] || all.find((el) => word.test(labelOf(el))) || all.find(long) || null;
  }

  /**
   * Greenhouse's phone field has its own "Country" picker right beside the number. A "Country" control next to the phone
   * input is that picker, not a question the employer asked (#1498).
   */
  function isPhoneCountry(el) {
    if (!/^country$/.test(labelOf(el))) return false;
    const all = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea, [role=combobox]")];
    const i = all.indexOf(el);
    const phone = (c) => !!c && c !== el && (c.type === "tel" || /^(?:(?:mobile|cell(?:ular)?|home|primary) )?phone\b/.test(labelOf(c)));
    return i >= 0 && (phone(all[i - 1]) || phone(all[i + 1]));
  }

  /** A dropdown opened by a button: Workday's selects are <button aria-haspopup="listbox"> with no combobox role (#1420). */
  const listButton = (el) => el.tagName === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox";

  // A button input ("Apply with LinkedIn") is not a field: typing into it overwrites its caption (#1399).
  function controlFor(prompt) {
    const input = "input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image])";
    return labeledBy([...document.querySelectorAll(`${input}, textarea, select, [role=combobox], button[aria-haspopup=listbox]`)], prompt);
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
    return legend ? norm(ownText(legend)) : labelOf(g);
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
    // A group with no name of its own is named by the words before its first box: "... about relocation" is not the later
    // "... about relocation benefits too", which also holds its first 60 characters. Of those that hold the question, the
    // shortest is the closest (#1409).
    const lead = (g) => {
      const first = g.querySelector("input[type=checkbox], input[type=radio]");
      const label = first.closest("label");
      const r = document.createRange();
      r.setStart(g, 0);
      r.setEndBefore(label && g.contains(label) ? label : first);
      return bare(norm(r.toString()));
    };
    const unnamed = groups
      .filter((g) => !groupName(g))
      .map((g) => ({ g, text: lead(g) }))
      .filter((u) => u.text.includes(q))
      .reverse() // on a tie the later group still wins, as before
      .sort((a, b) => a.text.length - b.text.length);
    return (
      groups.filter((g) => groupName(g) === q).pop() ||
      groups.filter((g) => groupName(g).startsWith(q)).pop() ||
      unnamed[0]?.g ||
      groups.pop() ||
      null
    );
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

  /**
   * Boxes under a plain heading with no fieldset or group role: Lever writes a question as a text div over a list of
   * labeled radios or checkboxes (#1419). The block is the nearest ancestor of the heading that holds any field, and
   * only if those fields are boxes, so a heading never borrows the next question's boxes from further up the form.
   */
  function blockFor(prompt) {
    const q = norm(prompt);
    const heads = [...document.querySelectorAll("body *")].filter((el) => !el.querySelector("input, select, textarea, button") && bare(norm(ownText(el))) === q);
    for (const h of heads) {
      let n = h.parentElement;
      while (n && n !== document.body && !n.querySelector("input:not([type=hidden]), select, textarea")) n = n.parentElement;
      if (n && n !== document.body && n.querySelector("input[type=checkbox], input[type=radio]")) return n;
    }
    return null;
  }

  /** Radios labeled with the question and their option ("Can you work onsite? No"), no group around them (#773). */
  function radiosFor(prompt) {
    const q = norm(prompt) + " ";
    return [...document.querySelectorAll("input[type=radio]")].filter((el) => labelOf(el).startsWith(q));
  }

  /** Checkboxes labeled with the question and their option ("Are you 18 or older? Yes"), no group around them (#1369). */
  function optionBoxesFor(prompt) {
    const q = norm(prompt) + " ";
    return [...document.querySelectorAll("input[type=checkbox]")].filter((el) => labelOf(el).startsWith(q));
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

  // Uploads this fill already put a file in. A later step that finds the same input (a combined "Resume/Cover Letter"
  // box, a label both prompts hold) would replace that file, so it reports not found instead (#1633).
  let filledUploads = new WeakSet();

  function fileInputFor(prompt, itemKind, labeledOnly = false) {
    const inputs = [...document.querySelectorAll("input[type=file]")];
    const pick = (input) => (input && !filledUploads.has(input) ? input : null);
    const key = norm(prompt).slice(0, 40);
    // Nearest labeled box wins, one level at a time: a section holding both uploads holds both labels (#590).
    // A cover letter's prompt must not match a resume input whose outer ancestor happens to hold the text
    // in a sibling subtree (#913): verify the matching text is in the input's own branch, not a sibling.
    for (let depth = 0; depth < 6; depth++)
      for (const input of inputs) {
        let n = input.parentElement;
        for (let i = 0; n && i < depth; i++) n = n.parentElement;
        if (!n || filledUploads.has(input) || !norm(n.textContent).includes(key)) continue;
        if (depth > 0 && (itemKind === "cover_letter" ? siblingHas(n, input, key) : otherBoxHas(n, input, key))) continue;
        return input;
      }
    if (labeledOnly) return null;
    // Unlabeled, only the resume takes the first upload and the letter the second. Any other upload (writing sample,
    // portfolio) would replace the resume there, so it reports not found instead (#1030).
    return itemKind === "cover_letter" ? pick(inputs[1]) : itemKind === "resume" ? pick(inputs[0]) : null;
  }

  /** a starts b and ends on a word boundary there: "no" starts "no, thanks" but not "none" (#632). A blank option starts nothing (#722). */
  const startsWord = (a, b) => !!a && b.startsWith(a) && (b.length === a.length || /\W/.test(b[a.length]) || /\W/.test(a[a.length - 1]));

  /**
   * Same rule as pickOptions in src/lib/application/fillPlan.ts: one answer per line, exact text first, then the same
   * text with or without hyphens and spaces (#1518), then a prefix
   * either way, at a word boundary, closest length first.
   */
  /** Same as compactChoice in fillPlan.ts: "Full time" is "Full-time", "Onsite" is "On-site", whole text only (#1518). "1-2" is never "12" (#1549). */
  const compact = (t) => norm(t).replace(/(\d)[\s'".-]+(?=\d)/g, "$1~").replace(/[\s'".-]+/g, "");

  function pickOptions(content, options) {
    const out = [];
    for (const part of (content || "").split(/\n+/).map((t) => t.trim()).filter(Boolean)) {
      const p = norm(part);
      const near = (options || []).filter((o) => startsWord(norm(o), p) || startsWord(p, norm(o))).sort((a, b) => Math.abs(norm(a).length - p.length) - Math.abs(norm(b).length - p.length));
      const hit = (options || []).find((o) => norm(o) === p) || (options || []).find((o) => !!compact(o) && compact(o) === compact(part)) || near[0];
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
    return /^(yes|true|(i(( have|'ve|’ve)? (read|reviewed)(,? understood,?)?| understand) and |(read|reviewed)(,? understood,?)? and |i (hereby )?)?(agreed?|acknowledged?|confirm(ed)?|consent(ed)?|certif(y|ied)|accept(ed)?|authori[sz]e[ds]?|attest(ed)?|affirm(ed)?|declared?)|i (hereby )?give (my )?consent|(i(( have|'ve|’ve)? (read|reviewed) and)? |(read|reviewed) and )?underst(and|ood))\b/.test(norm(answer));
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

  /** The answer's first number, same as the worker: "$165k" is 165000 (#1168), "$120-150k" is 120000 (#1254), "$120 K" is 120000 (#1585). */
  function numberAnswer(t) {
    // Dots grouped in threes are thousands: "€90.000" is 90000, same as the worker (#1747).
    // A space or apostrophe between groups of three is thousands too: "150 000 €" and "CHF 150'000" (#1752).
    // A curly apostrophe counts the same, and ",-" after the number is no cents: "CHF 150’000", "€ 90.000,-" (#1773).
    const s = String(t || "")
      .replace(/(?<![\d.,])\d{1,3}(?:\.\d{3})+(?:,\d{1,2}|,-{1,2})?(?![\d.,]|\s?[kKmM]\b)/g, (n) => n.split(",")[0].replace(/\./g, ""))
      .replace(/(?<![\d.,'\u2019])\d{1,3}(?:[ \u00a0\u202f'\u2019]\d{3})+(?:,\d{1,2}|,-{1,2})?(?![\d.,'\u2019])/g, (n) => n.split(",")[0].replace(/[ \u00a0\u202f'\u2019]/g, ""));
    const m = s.match(/(\d[\d,]*(?:\.\d+)?)((?:\s?(?:[kK]|[tT]housand|[mM]illion)|[mM]|\sM)\b)?(?:\s*(?:-|–|—|to|To|TO)\s*(?:[$€£¥₹]|[A-Z]{3}\s?)?\d[\d,]*(?:\.\d+)?((?:\s?(?:[kK]|[tT]housand|[mM]illion)|[mM]|\sM)\b))?/);
    if (!m) return "";
    const n = m[1].replace(/,/g, "");
    const unit = m[2] || (Number(n) < 1000 ? m[3] : undefined);
    return unit ? String(Math.round(Number(n) * (unit.trim()[0].toLowerCase() === "m" ? 1e6 : 1e3))) : n;
  }

  /**
   * A date field keeps only yyyy-mm-dd and drops anything else without a word, so "12/01/2026" or "December 1, 2026"
   * is turned into "2026-12-01" first; "" when the answer holds no date. Same as the worker (#1242).
   */
  function dateAnswer(t) {
    const s = String(t || "");
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    // A day the month doesn't have ("2026-02-30") is dropped by the field, so it reads as no date (#1295).
    const iso = (y, m, d) =>
      m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
    const mon = (w) => months.indexOf(w.slice(0, 3).toLowerCase()) + 1;
    // Year first with - or / ("2026/12/01"), and month first with a two-digit year ("12/15/26" is 2026) (#1295).
    // Dots too, and dots with the day first: "2026.12.01", "01.12.2026" (#1774).
    let m = s.match(/\b(\d{4})([/.-])(\d{1,2})\2(\d{1,2})\b/);
    if (m) return iso(+m[1], +m[3], +m[4]);
    m = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    if (m) return iso(+m[3], +m[2], +m[1]);
    m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/);
    if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
    if (m) return iso(+m[3], mon(m[1]), +m[2]);
    // "1-Dec-2026" and "1st of December 2026" too (#1774).
    m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+|\s+|-)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+|-)(\d{4})\b/i);
    if (m) return iso(+m[3], mon(m[2]), +m[1]);
    // A month and year with no day, "January 2027", "01/2027" or "2027-01", is the first of that month (#1801).
    m = s.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s+(\d{4})\b/i);
    if (m) return iso(+m[2], mon(m[1]), 1);
    m = s.match(/\b(\d{1,2})\/(\d{4})\b/);
    if (m) return iso(+m[2], +m[1], 1);
    m = s.match(/\b(\d{4})-(\d{1,2})\b(?![-/.]?\d)/);
    if (m) return iso(+m[1], +m[2], 1);
    // A day and month with no year, "Dec 1" or "1 December", is the next time that day comes, today included (#1850).
    // "May" followed by a word is the verb.
    const month = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may(?!\s+[a-z])|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
    const next = (mo, d) => {
      const now = new Date();
      const y = now.getFullYear();
      return Date.UTC(y, mo - 1, d) < Date.UTC(y, now.getMonth(), now.getDate()) ? iso(y + 1, mo, d) : iso(y, mo, d);
    };
    m = s.match(new RegExp(String.raw`\b${month}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?![:.]?\d)(?!\s*(?:days?|weeks?|wks?|months?|years?)\b)`, "i"));
    if (m) return next(mon(m[1]), +m[2]);
    m = s.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+|\s+|-)${month}(?![a-z])`, "i"));
    if (m) return next(mon(m[2]), +m[1]);
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
    // A letter's own text box beats an unlabeled upload: the second upload may be a Portfolio or Transcript (#1635).
    let input = fileInputFor(step.prompt, step.itemKind, true);
    if (!input && step.itemKind === "cover_letter" && (step.content || "").trim()) {
      // A cover letter asked for as text, not a file: type it into the box labeled with the prompt, same as the worker (#860, #1292).
      const box = controlFor(step.prompt);
      if (box && (box.tagName === "TEXTAREA" || (box.tagName === "INPUT" && /^(text)?$/.test(box.getAttribute("type") || "")))) {
        setValue(box, step.content);
        return { ok: true, how: "typed the letter" };
      }
    }
    if (!input) input = fileInputFor(step.prompt, step.itemKind);
    if (!input || !step.file) return { ok: false, how: step.file ? "upload field not found" : "no file" };
    const bytes = Uint8Array.from(atob(step.file.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], step.file.name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    filledUploads.add(input);
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
      // A box that only mentions the question ("I agree to share my gender for EEO reporting") is not the answer's field
      // when a group or radios are named by the question itself ("Gender") (#1407).
      const lone = el ? null : checkboxFor(step.prompt);
      const q = norm(step.prompt);
      const askedElsewhere = () => {
        const g = groupFor(step.prompt);
        return (g && bare(groupName(g)) === q) || radiosFor(step.prompt).length > 0;
      };
      const box = lone && step.kind === "choice" && labelOf(lone) !== q && askedElsewhere() ? null : lone;
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
        // Lever's plain-heading blocks only when nothing else names the question, so every earlier match stays first (#1419).
        const group = groupFor(step.prompt) || (!radiosFor(step.prompt).length && !optionBoxesFor(step.prompt).length ? blockFor(step.prompt) : null);
        if (!group) {
          // Check the radio the answer means, never the first one found, same as the worker (#720, #773).
          const radios = radiosFor(step.prompt);
          if (!radios.length) {
            // Checkboxes, one per option, each labeled with the question: tick the ones the answer means, same as the
            // worker (#1209, #1369).
            const boxes = optionBoxesFor(step.prompt);
            if (!boxes.length) return { ok: false, how: "field not found" };
            const picks = pickOptions(step.content, step.options);
            if (!picks.length) return { ok: false, how: "answer matches no option" };
            for (const label of picks) {
              const box = boxes.find((b) => optionAfter(labelOf(b), step.prompt) === norm(label));
              if (!box) return { ok: false, how: `option not found: ${label.slice(0, 60)}` };
              if (!box.checked) box.click();
            }
            return { ok: true, how: `checked ${picks.length}` };
          }
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
      if (el.getAttribute("role") === "combobox" || listButton(el) || step.kind === "choice") return await pickFromCombobox(el, step.content);
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
      // A value set from script skips maxlength, and the site's counter then blocks submit: the person shortens it (#1421).
      if (el.maxLength > 0 && el.value.length > el.maxLength) return { ok: false, how: `answer is ${el.value.length} characters, the field takes ${el.maxLength}` };
      return { ok: true, how: "typed" };
    } catch (e) {
      return { ok: false, how: String(e && e.message ? e.message : e).slice(0, 120) };
    }
  }

  /** Greenhouse's phone input has its own Country picker that isn't one of the questions. */
  async function phoneCountry(packet) {
    if (!packet.steps.some((s) => /^phone\b/i.test(s.prompt))) return null;
    const pickers = [...document.querySelectorAll("[role=combobox], select")].filter((c) => /^country$/.test(labelOf(c)));
    const country = packet.steps.filter((s) => /^country\b/i.test(s.prompt));
    // With a "Country" question on the form too, only the picker beside the phone, and only if the question went elsewhere (#1498).
    const el = country.length ? pickers.find(isPhoneCountry) : pickers[0];
    if (!el || country.some((s) => controlFor(s.prompt) === el)) return null;
    // The country the phone number dials from (#1794): "United Kingdom +44", never "United States Minor Outlying Islands".
    const want = packet.phoneCountry || "United States";
    const isWant = (text) => new RegExp(`^\\s*${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\s*[\\p{L}])`, "iu").test(text);
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => isWant(o.textContent));
      if (!opt) return { prompt: "Phone country", ok: false, how: `${want} not in the list` };
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { prompt: "Phone country", ok: true, how: "selected" };
    }
    const r = await pickFromCombobox(el, want, isWant);
    return { prompt: "Phone country", ...r };
  }

  function probe(packet) {
    let score = 0;
    for (const s of packet.steps) if (s.kind === "file" ? document.querySelector("input[type=file]") : controlFor(s.prompt) || groupFor(s.prompt) || checkboxFor(s.prompt) || radiosFor(s.prompt).length || optionBoxesFor(s.prompt).length || blockFor(s.prompt)) score++;
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
        // Counted by text, not position: a page that swaps its content drops the old match, so a new thank-you
        // would sit at an index already seen and never be noticed (#1290).
        const count = (list) => list.reduce((c, t) => c.set(t.toLowerCase(), (c.get(t.toLowerCase()) || 0) + 1), new Map());
        const before = count(matches());
        const obs = new MutationObserver(() => {
          const now = matches();
          const after = count(now);
          const m = now.find((t) => after.get(t.toLowerCase()) > (before.get(t.toLowerCase()) || 0));
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
      filledUploads = new WeakSet();
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
