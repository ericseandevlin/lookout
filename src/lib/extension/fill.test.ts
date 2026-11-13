import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { checksBox, pickOne, pickOptions } from "@/lib/application/fillPlan";

/**
 * The Firefox extension's form filler (#589): extension/firefox/fill.js, run in a real DOM and driven
 * through the same messages the popup sends. Only the extension API is stubbed.
 */
const SOURCE = readFileSync(path.resolve(__dirname, "../../../extension/firefox/fill.js"), "utf8");

type Step = { prompt: string; kind: string; content?: string; options?: string[]; required?: boolean; itemKind?: string; file?: { name: string; base64: string } };
type Packet = { steps: Step[]; phoneCountry?: string };
type LogRow = { prompt: string; required?: boolean; ok: boolean; how: string };
type Listener = (msg: unknown) => Promise<unknown>;

function page(body: string, setup?: (w: JSDOM["window"]) => void) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  // jsdom lays nothing out: count anything not display:none as on screen, and give it a box to click.
  w.Element.prototype.getClientRects = function (this: Element) {
    return (this.closest("[hidden]") || w.getComputedStyle(this).display === "none" ? [] : [{}]) as unknown as DOMRectList;
  };
  w.Element.prototype.scrollIntoView = () => {};
  // Nor innerText, which the thank-you watcher reads.
  Object.defineProperty(w.HTMLElement.prototype, "innerText", { configurable: true, get(this: HTMLElement) { return this.textContent ?? ""; } });
  // jsdom has no DataTransfer; keep what the filler hands the file input.
  w.DataTransfer = class {
    list: File[] = [];
    items = { add: (f: File) => this.list.push(f) };
    get files() {
      return this.list;
    }
  } as unknown as typeof DataTransfer;
  Object.defineProperty(w.HTMLInputElement.prototype, "files", {
    configurable: true,
    get(this: { _files?: File[] }) {
      return this._files ?? [];
    },
    set(this: { _files?: File[] }, v: File[]) {
      this._files = v;
    },
  });
  const sent: unknown[] = [];
  let listener: Listener | undefined;
  (w as unknown as { browser: unknown }).browser = {
    runtime: { onMessage: { addListener: (fn: Listener) => (listener = fn) }, sendMessage: (m: unknown) => sent.push(m) },
  };
  setup?.(w);
  w.eval(SOURCE);
  const doc = w.document;
  return {
    doc,
    w,
    sent,
    fill: async (packet: Packet) => ((await listener!({ type: "lookout-fill", appId: "app-1", packet })) as { log: LogRow[] }).log,
    probe: async (packet: Packet) => (await listener!({ type: "lookout-probe", packet })) as { score: number },
    value: (sel: string) => (doc.querySelector(sel) as HTMLInputElement).value,
  };
}

const text = (prompt: string, content: string): Step => ({ prompt, kind: "text", content, required: true });

describe("extension fill: text fields", () => {
  it("finds fields by <label for>, a wrapping label, aria-label and aria-labelledby", async () => {
    const p = page(`
      <label for="fn">First Name *</label><input id="fn">
      <label>Email <input id="em" type="email"></label>
      <input id="li" aria-label="LinkedIn Profile">
      <span id="q1">Why do you want to work here?</span><textarea id="why" aria-labelledby="q1"></textarea>`);
    const log = await p.fill({
      steps: [text("First Name", "Pat"), text("Email", "pat@example.com"), text("LinkedIn Profile", "https://linkedin.com/in/pat"), { prompt: "Why do you want to work here?", kind: "answer", content: "Because." }],
    });
    expect(log.map((r) => [r.ok, r.how])).toEqual([
      [true, "typed"],
      [true, "typed"],
      [true, "typed"],
      [true, "typed"],
    ]);
    expect([p.value("#fn"), p.value("#em"), p.value("#li"), p.value("#why")]).toEqual(["Pat", "pat@example.com", "https://linkedin.com/in/pat", "Because."]);
  });

  it("counts Greenhouse's double label (label for plus aria-labelledby) once", async () => {
    const p = page(`<label id="l" for="ln">Last Name</label><input id="ln" aria-labelledby="l">`);
    const [r] = await p.fill({ steps: [text("Last Name", "Lee")] });
    expect(r.ok).toBe(true);
    expect(p.value("#ln")).toBe("Lee");
  });

  it("prefers the exact label over one that only starts the same way", async () => {
    const p = page(`<label for="a">Location (City)</label><input id="a"><label for="b">Location</label><input id="b">`);
    await p.fill({ steps: [text("Location", "New York, NY")] });
    expect([p.value("#a"), p.value("#b")]).toEqual(["", "New York, NY"]);
  });

  it("never puts a question's answer in a shorter field the question only starts with (#888)", async () => {
    const p = page(`<label for="loc">Location</label><input id="loc">
      <fieldset><legend>Location: can you work from our New York office 3 days a week?</legend>
        <label><input type="radio" name="q" id="y">Yes</label><label><input type="radio" name="q" id="n">No</label></fieldset>`);
    const log = await p.fill({
      steps: [text("Location", "Brooklyn, NY"), { prompt: "Location: can you work from our New York office 3 days a week?", kind: "choice", content: "Yes", options: ["Yes", "No"] }],
    });
    expect(log.map((r) => r.ok)).toEqual([true, true]);
    expect(p.value("#loc")).toBe("Brooklyn, NY");
    expect((p.doc.querySelector("#y") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps a select and a radio group whose question starts the same apart (#888)", async () => {
    const p = page(`<label for="s">Do you require sponsorship?</label><select id="s"><option></option><option>Yes</option><option>No</option></select>
      <fieldset><legend>Do you require sponsorship? (now or in the future)</legend>
        <label><input type="radio" name="f" id="fy">Yes</label><label><input type="radio" name="f" id="fn">No</label></fieldset>`);
    await p.fill({
      steps: [
        { prompt: "Do you require sponsorship?", kind: "choice", content: "No", options: ["Yes", "No"] },
        { prompt: "Do you require sponsorship? (now or in the future)", kind: "choice", content: "Yes", options: ["Yes", "No"] },
      ],
    });
    expect((p.doc.querySelector("#s") as HTMLSelectElement).value).toBe("No");
    expect((p.doc.querySelector("#fy") as HTMLInputElement).checked).toBe(true);
  });

  it("still finds a field whose label holds the question", async () => {
    const p = page(`<label for="w">Portfolio Website (optional)</label><input id="w">`);
    const [r] = await p.fill({ steps: [text("Portfolio Website", "https://pat.design")] });
    expect(r.ok).toBe(true);
    expect(p.value("#w")).toBe("https://pat.design");
  });

  it("fires input and change so React-style forms see the value", async () => {
    const p = page(`<label for="fn">First Name</label><input id="fn">`);
    const seen: string[] = [];
    for (const t of ["input", "change"]) p.doc.querySelector("#fn")!.addEventListener(t, () => seen.push(t));
    await p.fill({ steps: [text("First Name", "Pat")] });
    expect(seen).toEqual(["input", "change"]);
  });

  it("reports a field that isn't on the page, with its required flag", async () => {
    const p = page(`<label for="fn">First Name</label><input id="fn">`);
    const [r] = await p.fill({ steps: [text("Middle Name", "J")] });
    expect(r).toEqual({ prompt: "Middle Name", required: true, ok: false, how: "field not found" });
  });
});

describe("extension fill: choices", () => {
  it("selects a native <select> option by its text", async () => {
    const p = page(`<label for="s">Are you authorized to work in the US?</label><select id="s"><option value="">Select</option><option value="1">Yes</option><option value="0">No</option></select>`);
    const [r] = await p.fill({ steps: [{ prompt: "Are you authorized to work in the US?", kind: "choice", content: "Yes", options: ["Yes", "No"] }] });
    expect(r).toMatchObject({ ok: true, how: "selected" });
    expect(p.value("#s")).toBe("1");
  });

  it("says so when the answer isn't one of the <select> options", async () => {
    const p = page(`<label for="s">Pronouns</label><select id="s"><option>She/her</option><option>He/him</option></select>`);
    const [r] = await p.fill({ steps: [{ prompt: "Pronouns", kind: "choice", content: "They/them" }] });
    expect(r).toMatchObject({ ok: false, how: "option not in the list" });
  });

  it("does not match a $ answer to a blank placeholder option (#722)", async () => {
    const p = page(`<label for="s">Desired salary range</label><select id="s"><option value="">  </option><option value="a">$100,000 - $150,000</option><option value="b">$150,000+</option></select>`);
    const [r] = await p.fill({ steps: [{ prompt: "Desired salary range", kind: "choice", content: "$185,000", options: ["", "$100,000 - $150,000", "$150,000+"] }] });
    expect(r).toMatchObject({ ok: false, how: "option not in the list" });
  });

  it("selects the <select> option the answer means, not one that only starts with its letters (#644)", async () => {
    const p = page(`<label for="s">Do you have a disability?</label><select id="s"><option value="">Select</option><option value="x">None of the above</option><option value="n">No, I do not have a disability</option></select>`);
    const [r] = await p.fill({ steps: [{ prompt: "Do you have a disability?", kind: "choice", content: "No" }] });
    expect(r).toMatchObject({ ok: true, how: "selected" });
    expect(p.value("#s")).toBe("n");
  });

  it("still matches a long <select> option by its first 80 characters", async () => {
    const long = "I acknowledge that I have read and understood the privacy notice for job applicants in the United States";
    const p = page(`<label for="s">Privacy notice</label><select id="s"><option value="">Select</option><option value="ok">${long} (2026 edition)</option></select>`);
    const [r] = await p.fill({ steps: [{ prompt: "Privacy notice", kind: "choice", content: `${long}.` }] });
    expect(r).toMatchObject({ ok: true, how: "selected" });
    expect(p.value("#s")).toBe("ok");
  });

  it("picks the same <select> option as the server worker's rule (#695)", async () => {
    const cases: [string, string[]][] = [
      ["Yes, I am authorized to work in the US", ["Select", "Yes", "No"]],
      ["No", ["Select", "None of the above", "No, I do not have a disability"]],
      ["None", ["Select", "No", "None of the above"]],
      ["They/them", ["She/her", "He/him"]],
    ];
    for (const [content, options] of cases) {
      const p = page(`<label for="s">Q</label><select id="s">${options.map((o, i) => `<option value="${i}">${o}</option>`).join("")}</select>`);
      const [r] = await p.fill({ steps: [{ prompt: "Q", kind: "choice", content }] });
      const want = pickOne(content, options);
      expect(r.ok, content).toBe(want >= 0);
      if (want >= 0) expect(p.value("#s"), content).toBe(String(want));
    }
  });

  it("checks a radio in a fieldset by its label", async () => {
    const p = page(`<fieldset><legend>Will you require sponsorship?</legend>
      <label><input type="radio" name="sp" id="y"> Yes</label><label><input type="radio" name="sp" id="n"> No</label></fieldset>`);
    const [r] = await p.fill({ steps: [{ prompt: "Will you require sponsorship?", kind: "choice", content: "No", options: ["Yes", "No"] }] });
    expect(r).toMatchObject({ ok: true, how: "checked 1" });
    expect((p.doc.querySelector("#n") as HTMLInputElement).checked).toBe(true);
    expect((p.doc.querySelector("#y") as HTMLInputElement).checked).toBe(false);
  });

  it("answers the group named by the question, not a later one whose question starts the same (#720)", async () => {
    const p = page(`<fieldset><legend>Do you require sponsorship? *</legend>
      <label><input type="radio" name="a" id="a-y"> Yes</label><label><input type="radio" name="a" id="a-n"> No</label></fieldset>
      <fieldset><legend>Do you require sponsorship? (now or in the future)</legend>
      <label><input type="radio" name="b" id="b-y"> Yes</label><label><input type="radio" name="b" id="b-n"> No</label></fieldset>`);
    const log = await p.fill({
      steps: [
        { prompt: "Do you require sponsorship?", kind: "choice", content: "No", options: ["Yes", "No"] },
        { prompt: "Do you require sponsorship? (now or in the future)", kind: "choice", content: "Yes", options: ["Yes", "No"] },
      ],
    });
    expect(log.map((r) => r.ok)).toEqual([true, true]);
    const on = (id: string) => (p.doc.querySelector(`#${id}`) as HTMLInputElement).checked;
    expect([on("a-y"), on("a-n"), on("b-y"), on("b-n")]).toEqual([false, true, true, false]);
  });

  it("checks the radio labeled with the question and the option the answer means (#773)", async () => {
    const p = page(`<span id="q9">Can you work onsite? *</span>
      <input type="radio" name="w" id="w-y" aria-labelledby="q9 l1"><span id="l1">Yes</span>
      <input type="radio" name="w" id="w-n" aria-labelledby="q9 l2"><span id="l2">No</span>`);
    const steps = [{ prompt: "Can you work onsite?", kind: "choice", content: "No, I work remotely", options: ["Yes", "No"] }];
    expect(await p.probe({ steps })).toEqual({ score: 1 });
    const [r] = await p.fill({ steps });
    expect(r).toMatchObject({ ok: true, how: "checked 1" });
    expect((p.doc.querySelector("#w-n") as HTMLInputElement).checked).toBe(true);
    expect((p.doc.querySelector("#w-y") as HTMLInputElement).checked).toBe(false);
  });

  it("never clicks a question-labeled radio the answer doesn't name (#773)", async () => {
    const p = page(`<span id="q">Preferred office</span>
      <input type="radio" name="o" id="o1" aria-labelledby="q l1"><span id="l1">Austin</span>`);
    const log = await p.fill({
      steps: [
        { prompt: "Preferred office", kind: "choice", content: "Remote", options: ["Austin"] },
        { prompt: "Preferred office", kind: "choice", content: "Denver", options: ["Austin", "Denver"] },
      ],
    });
    expect(log).toMatchObject([{ ok: false, how: "answer matches no option" }, { ok: false, how: "option not found: Denver" }]);
    expect((p.doc.querySelector("#o1") as HTMLInputElement).checked).toBe(false);
  });

  it("ticks one radio in a group, the first line that lands, like the worker (#773)", async () => {
    const p = page(`<fieldset><legend>Work arrangement</legend>
      <label><input type="radio" name="a" id="a-r"> Remote</label><label><input type="radio" name="a" id="a-h"> Hybrid</label></fieldset>`);
    const [r] = await p.fill({ steps: [{ prompt: "Work arrangement", kind: "choice", content: "Remote\nHybrid", options: ["Remote", "Hybrid"] }] });
    expect(r).toMatchObject({ ok: true, how: "checked 1" });
    expect((p.doc.querySelector("#a-r") as HTMLInputElement).checked).toBe(true);
    expect((p.doc.querySelector("#a-h") as HTMLInputElement).checked).toBe(false);
  });

  it("checks every line of a select-all answer, matching a prefix either way, and leaves the rest", async () => {
    const options = ["Figma", "Sketch", "Adobe Creative Suite", "Framer"];
    const p = page(`<div role="group"><span>Which tools do you use?</span>
      ${options.map((o, i) => `<label><input type="checkbox" id="c${i}"> ${o}</label>`).join("")}</div>`);
    const content = "Figma\nAdobe\nFramer";
    const [r] = await p.fill({ steps: [{ prompt: "Which tools do you use?", kind: "choice", content, options }] });
    expect(r).toMatchObject({ ok: true, how: "checked 3" });
    const checked = options.filter((_, i) => (p.doc.querySelector(`#c${i}`) as HTMLInputElement).checked);
    expect(checked).toEqual(["Figma", "Adobe Creative Suite", "Framer"]);
    // Same picks as the server's rule (src/lib/application/fillPlan.ts).
    expect(checked).toEqual(pickOptions(content, options));
  });

  it("ticks the closest option, not a shorter one that shares a prefix (#632)", async () => {
    const options = ["No", "None of the above"];
    const p = page(`<fieldset><legend>Do any of these apply?</legend>
      ${options.map((o, i) => `<label><input type="checkbox" id="c${i}"> ${o}</label>`).join("")}</fieldset>`);
    const [r] = await p.fill({ steps: [{ prompt: "Do any of these apply?", kind: "choice", content: "None", options }] });
    expect(r).toMatchObject({ ok: true, how: "checked 1" });
    expect((p.doc.querySelector("#c0") as HTMLInputElement).checked).toBe(false);
    expect((p.doc.querySelector("#c1") as HTMLInputElement).checked).toBe(true);
    expect(pickOptions("None", options)).toEqual(["None of the above"]);
  });

  it("ticks nothing when no line of the answer matches an option", async () => {
    const p = page(`<fieldset><legend>Preferred office</legend><label><input type="radio" name="o" id="o1"> Austin</label></fieldset>`);
    const [r] = await p.fill({ steps: [{ prompt: "Preferred office", kind: "choice", content: "Remote", options: ["Austin"] }] });
    expect(r).toMatchObject({ ok: false, how: "answer matches no option" });
    expect((p.doc.querySelector("#o1") as HTMLInputElement).checked).toBe(false);
  });

  it("ticks a lone labeled checkbox on any yes, by the same rule as the server (#669)", async () => {
    const answers = ["Yes, I agree", "I acknowledge", "I certify", "No", "", "I do not agree", "Agreed", "I have read and agree", "I understand", "I have read and understand", "I authorize", "I attest"];
    const p = page(answers.map((_, i) => `<label><input type="checkbox" id="b${i}"> Consent ${i}</label>`).join(""));
    const log = await p.fill({ steps: answers.map((content, i) => ({ prompt: `Consent ${i}`, kind: "text", content, required: false })) });
    const ticked = answers.map((_, i) => (p.doc.querySelector(`#b${i}`) as HTMLInputElement).checked);
    expect(ticked).toEqual([true, true, true, false, false, false, true, true, true, true, true, true]);
    expect(ticked).toEqual(answers.map(checksBox));
    expect(log.map((l) => l.how)).toEqual(["checked", "checked", "checked", "left unchecked", "left unchecked", "left unchecked", "checked", "checked", "checked", "checked", "checked", "checked"]);
  });

  it("unticks a box the site ticked ahead when the answer is no (#788)", async () => {
    const p = page(`<label><input type="checkbox" id="alerts" checked> Send me job alerts</label>`);
    const [r] = await p.fill({ steps: [{ prompt: "Send me job alerts", kind: "text", content: "No", required: false }] });
    expect(r).toMatchObject({ ok: true, how: "left unchecked" });
    expect((p.doc.querySelector("#alerts") as HTMLInputElement).checked).toBe(false);
  });

  it("reports a required checkbox it can't tick or can't find (#669)", async () => {
    const p = page(`<input type="checkbox" id="pp" aria-label="I agree to the privacy policy">`);
    const log = await p.fill({
      steps: [
        { prompt: "I agree to the privacy policy", kind: "text", content: "No", required: true },
        { prompt: "I certify the above is true", kind: "text", content: "Yes", required: true },
      ],
    });
    expect(log.map((l) => [l.ok, l.how])).toEqual([
      [false, "answer is not a yes"],
      [false, "field not found"],
    ]);
    expect((p.doc.querySelector("#pp") as HTMLInputElement).checked).toBe(false);
  });

  it("does not untick a lone checkbox that is already ticked", async () => {
    const p = page(`<label><input type="checkbox" id="t" checked> I agree to the terms</label>`);
    const [r] = await p.fill({ steps: [{ prompt: "I agree to the terms", kind: "text", content: "Yes" }] });
    expect(r).toMatchObject({ ok: true, how: "checked" });
    expect((p.doc.querySelector("#t") as HTMLInputElement).checked).toBe(true);
  });

  it("does not uncheck a box that is already checked", async () => {
    const p = page(`<fieldset><legend>Agree to terms</legend><label><input type="checkbox" id="t" checked> I agree</label></fieldset>`);
    await p.fill({ steps: [{ prompt: "Agree to terms", kind: "choice", content: "I agree", options: ["I agree"] }] });
    expect((p.doc.querySelector("#t") as HTMLInputElement).checked).toBe(true);
  });
});

/** A react-select style picker: the list renders on mousedown; clicking an option sets the visible value. */
function combobox(w: JSDOM["window"], id: string, options: string[]) {
  const input = w.document.getElementById(id) as HTMLInputElement;
  input.addEventListener("mousedown", () => {
    const list = w.document.createElement("div");
    list.id = `${id}-list`;
    for (const o of options) {
      const el = w.document.createElement("div");
      el.setAttribute("role", "option");
      el.textContent = o;
      el.addEventListener("click", () => {
        input.dataset.picked = o;
        list.remove();
      });
      list.append(el);
    }
    w.document.body.append(list);
  });
}

describe("extension fill: custom dropdowns", () => {
  it("opens a combobox with a real-looking click and picks the matching option", async () => {
    const p = page(`<label for="loc">Which office?</label><input id="loc" role="combobox">`);
    combobox(p.w, "loc", ["Austin", "New York", "Remote"]);
    const [r] = await p.fill({ steps: [{ prompt: "Which office?", kind: "choice", content: "New York", options: ["Austin", "New York", "Remote"] }] });
    expect(r).toMatchObject({ ok: true, how: "picked option" });
    expect((p.doc.querySelector("#loc") as HTMLInputElement).dataset.picked).toBe("New York");
  });

  it("picks the option at a word boundary, not a longer word that starts the same (#644)", async () => {
    const p = page(`<label for="vet">Veteran status</label><input id="vet" role="combobox">`);
    combobox(p.w, "vet", ["Not applicable", "No, I am not a protected veteran", "Yes"]);
    const [r] = await p.fill({ steps: [{ prompt: "Veteran status", kind: "choice", content: "No" }] });
    expect(r).toMatchObject({ ok: true, how: "picked option" });
    expect((p.doc.querySelector("#vet") as HTMLInputElement).dataset.picked).toBe("No, I am not a protected veteran");
  });

  it("gives up with a reason when the answer isn't in the list", async () => {
    const p = page(`<label for="loc">Which office?</label><input id="loc" role="combobox">`);
    combobox(p.w, "loc", ["Austin"]);
    const [r] = await p.fill({ steps: [{ prompt: "Which office?", kind: "choice", content: "Denver" }] });
    expect(r).toMatchObject({ ok: false, how: "option not in the list" });
  }, 10_000);

  it("sets the phone's own country picker to United States, not the Minor Outlying Islands", async () => {
    const p = page(`<label for="ph">Phone</label><input id="ph"><label for="cc">Country</label><input id="cc" role="combobox">`);
    combobox(p.w, "cc", ["United Kingdom", "United States Minor Outlying Islands", "United States"]);
    const log = await p.fill({ steps: [text("Phone", "555-0100")] });
    expect(log[1]).toEqual({ prompt: "Phone country", ok: true, how: "picked option" });
    expect((p.doc.querySelector("#cc") as HTMLInputElement).dataset.picked).toBe("United States");
  });

  it("picks United States from a native country <select> next to the phone", async () => {
    const p = page(`<label for="ph">Phone</label><input id="ph"><label for="cc">Country</label>
      <select id="cc"><option value="um">United States Minor Outlying Islands</option><option value="us">United States</option></select>`);
    const log = await p.fill({ steps: [text("Phone", "555-0100")] });
    expect(log[1]).toEqual({ prompt: "Phone country", ok: true, how: "selected" });
    expect(p.value("#cc")).toBe("us");
  });

  it("leaves the country alone when the form asks Country as its own question", async () => {
    const p = page(`<label for="ph">Phone</label><input id="ph"><label for="cc">Country</label><input id="cc">`);
    const log = await p.fill({ steps: [text("Phone", "555-0100"), text("Country", "Canada")] });
    expect(log.map((r) => r.prompt)).toEqual(["Phone", "Country"]);
    expect(p.value("#cc")).toBe("Canada");
  });
});

describe("extension fill: uploads", () => {
  const docx = (name: string) => ({ name, base64: Buffer.from("PK fake docx").toString("base64") });

  const both = [
    { prompt: "Resume/CV", kind: "file", itemKind: "resume", file: docx("Pat Lee - Acme Resume.docx") },
    { prompt: "Cover Letter", kind: "file", itemKind: "cover_letter", file: docx("Pat Lee - Acme Cover Letter.docx") },
  ];
  const fileName = (p: ReturnType<typeof page>, id: string) => (p.doc.getElementById(id) as unknown as { files: File[] }).files[0]?.name;

  // One section holds both uploads, so it holds both labels; the nearest label decides (#590).
  for (const [order, body] of [
    ["resume first", `<section><div><div><label>Resume/CV</label><input type="file" id="cv"></div></div><div><div><label>Cover Letter</label><input type="file" id="cl"></div></div></section>`],
    ["cover letter first", `<section><div><div><label>Cover Letter</label><input type="file" id="cl"></div></div><div><div><label>Resume/CV</label><input type="file" id="cv"></div></div></section>`],
  ])
    it(`puts the resume and cover letter in the inputs labeled for them, ${order} (#590)`, async () => {
      const p = page(body);
      const log = await p.fill({ steps: both });
      expect(log.map((r) => r.how)).toEqual(["uploaded .docx", "uploaded .docx"]);
      expect([fileName(p, "cv"), fileName(p, "cl")]).toEqual(["Pat Lee - Acme Resume.docx", "Pat Lee - Acme Cover Letter.docx"]);
    });

  it("falls back to the first input for the resume and the second for the letter", async () => {
    const p = page(`<input type="file" id="a"><input type="file" id="b">`);
    await p.fill({
      steps: [
        { prompt: "Attach", kind: "file", itemKind: "resume", file: docx("r.docx") },
        { prompt: "Attach another", kind: "file", itemKind: "cover_letter", file: docx("c.docx") },
      ],
    });
    const name = (id: string) => (p.doc.getElementById(id) as unknown as { files: File[] }).files[0]?.name;
    expect([name("a"), name("b")]).toEqual(["r.docx", "c.docx"]);
  });

  it("reports a missing file or a page with no upload field", async () => {
    const none = page(`<p>No uploads here</p>`);
    const [a] = await none.fill({ steps: [{ prompt: "Resume", kind: "file", itemKind: "resume", file: docx("r.docx") }] });
    expect(a.how).toBe("upload field not found");
    const some = page(`<input type="file">`);
    const [b] = await some.fill({ steps: [{ prompt: "Resume", kind: "file", itemKind: "resume" }] });
    expect(b.how).toBe("no file");
  });
});

describe("extension probe and submit watch", () => {
  it("scores a frame by how many steps it has a place for", async () => {
    const p = page(`<label for="fn">First Name</label><input id="fn"><input type="file">`);
    const steps = [text("First Name", "Pat"), text("Email", "x"), { prompt: "Resume", kind: "file", itemKind: "resume" }];
    expect(await p.probe({ steps })).toEqual({ score: 2 });
  });

  it("after Fill, a Submit click arms the watcher and the thank-you text is reported", async () => {
    const p = page(`<form><label for="fn">First Name</label><input id="fn"><button type="button" id="go">Submit application</button></form>`);
    await p.fill({ steps: [text("First Name", "Pat")] });
    (p.doc.getElementById("go") as HTMLButtonElement).click();
    expect(p.sent).toEqual([{ type: "lookout-armed", appId: "app-1" }]);
    const done = p.doc.createElement("p");
    done.textContent = "Thank you for applying to Acme!";
    p.doc.body.append(done);
    await new Promise((r) => setTimeout(r, 20));
    expect(p.sent[1]).toMatchObject({ type: "lookout-thanks", appId: "app-1", text: "Thank you for applying" });
  });

  it("thank-you text already on the page doesn't count; a new one after Submit does (#784)", async () => {
    const p = page(`<p>Once your application has been received, a recruiter will reach out.</p><form><label for="fn">First Name</label><input id="fn"><button type="button" id="go">Submit application</button></form>`);
    await p.fill({ steps: [text("First Name", "Pat")] });
    (p.doc.getElementById("go") as HTMLButtonElement).click();
    const err = p.doc.createElement("p");
    err.textContent = "Please fix the errors above.";
    p.doc.body.append(err);
    await new Promise((r) => setTimeout(r, 20));
    expect(p.sent).toEqual([{ type: "lookout-armed", appId: "app-1" }]);
    const done = p.doc.createElement("p");
    done.textContent = "Your application has been submitted.";
    p.doc.body.append(done);
    await new Promise((r) => setTimeout(r, 20));
    expect(p.sent[1]).toMatchObject({ type: "lookout-thanks", appId: "app-1", text: "application has been submitted" });
  });
});
