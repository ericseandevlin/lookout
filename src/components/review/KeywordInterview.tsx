"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeywordInterview as Out, KeywordQuestion, KeywordResult } from "@/lib/interview/keywords";
import { Composer, QuestionBubble, Said, Thinking } from "../chat";
import { btn } from "../Settings";
import { api } from "../store";
import { Modal } from "./Modal";
import { color, font } from "@/lib/tokens";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One line of the dialog's chat. */
type Line = { k: "q"; text: string; why: string } | { k: "you"; text: string | null } | { k: "lookout"; text: string };

/**
 * What Lookout says after an answer, in as few words as work (#1485). Null when the next thing said is a follow-up
 * question, which speaks for itself. `last` is the line said before, so the same words never come twice in a row.
 */
export function resultLine(answer: string | null, r: KeywordResult, last?: string): string | null {
  if (answer === null) return pick(["Skipped.", "Skipped. Next one."], last);
  if (r.note) return r.note;
  if (r.declined) return pick(["Got it. Marked not relevant.", "Noted. Not relevant."], last);
  const saved = r.saved ? `Saved ${plural(r.saved, "fact")}.` : "";
  const moved = r.backed.length ? ` ${r.backed.join(", ")} ${r.backed.length === 1 ? "moves" : "move"} to In your resume.` : "";
  if (r.followUp) return saved || null;
  if (!saved) return pick(["Thanks.", "Got it, thanks."], last);
  return `${saved}${moved}${r.private ? ` ${r.private} kept private.` : ""}`;
}
const pick = (options: string[], last?: string) => options.find((o) => o !== last) ?? options[0];

/**
 * The interview as a dialog on the review page (#1485): a story question per group of missing keywords, and one
 * follow-up when an answer is thin. Each answer goes through the server, which saves facts and backs keywords; the
 * page behind updates as soon as it comes back.
 */
export function KeywordInterview({ appId, questions, close, onChange }: { appId: string; questions: KeywordQuestion[]; close: () => void; onChange: (o: Out) => void }) {
  const [queue, setQueue] = useState(questions);
  const ask = (q: KeywordQuestion): Line => ({ k: "q", text: q.followUp ?? q.question, why: q.followUp ? "" : q.why });
  const [log, setLog] = useState<Line[]>(() => (questions[0] ? [ask(questions[0])] : []));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "answer" | "skip">(null);
  const [pending, setPending] = useState<{ text: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [moved, setMoved] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const cur = queue[0] ?? null;

  useEffect(() => {
    box.current?.focus();
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, busy, err, pending]);

  const send = async (action: "answer" | "skip") => {
    if (!cur || busy) return;
    // The answer moves into the chat right away; dots show where Lookout's reply will appear (#1485).
    const said = text;
    const answer = action === "answer" ? said.trim() : null;
    setBusy(action);
    setPending({ text: answer });
    setText("");
    setErr(null);
    try {
      const o = await api<Out & { result: KeywordResult }>(`/api/apply/${appId}/interview`, { method: "POST", json: { action, question: cur.id, text: said } });
      const next = o.questions[0];
      setLog((l) => {
        const lastLookout = [...l].reverse().find((x) => x.k === "lookout")?.text;
        const line = resultLine(answer, o.result, lastLookout);
        return [...l, { k: "you", text: answer }, ...(line ? [{ k: "lookout", text: line } as Line] : []), ...(next ? [ask(next)] : [])];
      });
      setMoved((m) => m + o.result.backed.length);
      setQueue(o.questions);
      onChange(o);
      requestAnimationFrame(() => box.current?.focus());
    } catch (e) {
      setText(said);
      setErr(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setPending(null);
      setBusy(null);
    }
  };

  return (
    <Modal title="Back these keywords" kicker="Interview" close={close} chat>
      <div ref={scroller} data-chat-scroll="" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* No count: a follow-up can add a question (#1485). */}
        <Said who="Lookout">A few quick questions. Skip any you haven&apos;t done.</Said>
        {log.map((l, i) =>
          l.k === "q" ? (
            <QuestionBubble key={i} question={l.text} why={l.why} />
          ) : l.k === "you" ? (
            <Said key={i} who="You">
              {l.text ?? <em>Skipped</em>}
            </Said>
          ) : (
            <Said key={i} who="Lookout">
              {l.text}
            </Said>
          ),
        )}
        {pending && (
          <>
            <Said who="You" rise>
              {pending.text ?? <em>Skipped</em>}
            </Said>
            <Thinking />
          </>
        )}
        {!cur && !pending && <Said who="Lookout">That&apos;s all of them. {moved ? `${plural(moved, "keyword")} moved to In your resume.` : "No keyword moved this time."}</Said>}
      </div>
      <div style={{ borderTop: `1.5px solid ${color.border}`, padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {err && (
          <div role="alert" style={{ fontSize: font.lg, color: color.brick }}>
            {err}
          </div>
        )}
        {cur ? (
          <Composer id="kw-answer" boxRef={box} value={text} onChange={setText} onSend={() => send("answer")} onSkip={() => send("skip")} busy={busy} />
        ) : (
          <button onClick={close} style={{ ...btn("solid"), alignSelf: "flex-start", height: 44, fontSize: font.lg }}>
            Done
          </button>
        )}
      </div>
    </Modal>
  );
}
