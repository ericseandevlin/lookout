"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeywordInterview as Out, KeywordQuestion, KeywordResult } from "@/lib/interview/keywords";
import { Composer, QuestionBubble, Said, Thinking } from "../chat";
import { btn } from "../Settings";
import { api } from "../store";
import { Modal } from "./Modal";
import { color, font } from "@/lib/tokens";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
type Done = { q: KeywordQuestion; answer: string | null; result: KeywordResult };

/** What Lookout says after an answer or a skip. */
export function resultLine(d: Done) {
  const r = d.result;
  if (d.answer === null) return "Skipped. Nothing added.";
  if (r.note) return r.note;
  if (!r.saved) return "Nothing to save from that one. These keywords stay missing.";
  const moved = r.backed.length ? ` ${r.backed.join(", ")} ${r.backed.length === 1 ? "moves" : "move"} to In your resume.` : " None of these keywords are backed by it yet.";
  return `Saved ${plural(r.saved, "fact")}.${moved}${r.private ? ` ${r.private} kept private.` : ""}`;
}

/**
 * The interview as a dialog on the review page (#1485): one question per group of missing keywords. Each answer goes
 * through the server, which saves facts and backs keywords; the page behind updates as soon as it comes back.
 */
export function KeywordInterview({ appId, questions, close, onChange }: { appId: string; questions: KeywordQuestion[]; close: () => void; onChange: (o: Out) => void }) {
  const [queue, setQueue] = useState(questions);
  const [done, setDone] = useState<Done[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "answer" | "skip">(null);
  const [pending, setPending] = useState<{ text: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [total] = useState(questions.length);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const cur = queue[0] ?? null;
  const moved = done.reduce((n, d) => n + d.result.backed.length, 0);

  useEffect(() => {
    box.current?.focus();
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [done.length, busy, err, pending]);

  const send = async (action: "answer" | "skip") => {
    if (!cur || busy) return;
    // The answer moves into the chat right away; dots show where Lookout's reply will appear (#1485).
    const said = text;
    setBusy(action);
    setPending({ text: action === "answer" ? said.trim() : null });
    setText("");
    setErr(null);
    try {
      const o = await api<Out & { result: KeywordResult }>(`/api/apply/${appId}/interview`, { method: "POST", json: { action, question: cur.id, text: said } });
      setDone((d) => [...d, { q: cur, answer: action === "answer" ? said.trim() : null, result: o.result }]);
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
        <Said who="Lookout">
          {plural(total, "quick question")}. Skip any you haven&apos;t done.
        </Said>
        {done.map((d) => (
          <div key={d.q.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <QuestionBubble question={d.q.question} why={d.q.why} />
            <Said who="You">{d.answer ?? <em>Skipped</em>}</Said>
            <Said who="Lookout">{resultLine(d)}</Said>
          </div>
        ))}
        {cur && <QuestionBubble question={cur.question} why={cur.why} />}
        {pending && (
          <>
            <Said who="You" rise>
              {pending.text ?? <em>Skipped</em>}
            </Said>
            <Thinking />
          </>
        )}
        {!cur && (
          <Said who="Lookout">
            That&apos;s all of them. {moved ? `${plural(moved, "keyword")} moved to In your resume.` : "No keyword moved this time."}
          </Said>
        )}
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
